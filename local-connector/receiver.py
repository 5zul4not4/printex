import os
import json
import threading
import time
import cgi
import io
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from firebase_admin import firestore
import firebase_admin

TEMP_DIR = None
RELATED_URL = None
DB = None
PRINTER_IDS = []
HOST = "0.0.0.0"
PORT = 9876

_relay_sessions = {}
_http_server = None


def get_local_ip():
    import socket

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"


class FileUploadHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        path_parts = urlparse(self.path).path.split("/")
        if len(path_parts) < 3 or path_parts[1] != "upload":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return

        session_id = path_parts[2]

        try:
            content_type = self.headers.get("Content-Type", "")
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type},
            )

            if "file" not in form:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"No file field in request")
                return

            file_item = form["file"]
            filename = file_item.filename or f"file_{session_id}"

            session_dir = os.path.join(TEMP_DIR, session_id)
            os.makedirs(session_dir, exist_ok=True)

            filepath = os.path.join(session_dir, filename)
            with open(filepath, "wb") as f:
                f.write(file_item.file.read())

            file_size = os.path.getsize(filepath)
            print(
                f"  Received file '{filename}' ({file_size} bytes) via HTTP for session {session_id}"
            )

            if DB:
                try:
                    DB.collection("stream_sessions").document(session_id).update(
                        {
                            "status": "completed",
                            "progress": 100,
                            "method": "http",
                        }
                    )
                except Exception as e:
                    print(
                        f"  Warning: Could not update Firestore session {session_id}: {e}"
                    )

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {"success": True, "filename": filename, "size": file_size}
                ).encode()
            )

        except Exception as e:
            print(f"  HTTP upload error for session {session_id}: {e}")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"PrintEx File Receiver")

    def log_message(self, format, *args):
        pass


def start_http_server(host=None, port=None):
    global _http_server, HOST, PORT
    if host:
        HOST = host
    if port:
        PORT = port

    server = HTTPServer((HOST, PORT), FileUploadHandler)
    _http_server = server
    thread = threading.Thread(
        target=server.serve_forever, name="http-receiver", daemon=True
    )
    thread.start()
    print(f" File receiver HTTP server started on {HOST}:{PORT}")
    return server


def stop_http_server():
    global _http_server
    if _http_server:
        _http_server.shutdown()
        _http_server = None


def connect_relay_for_session(session_id, relay_url):
    import websocket

    ws_url = f"{relay_url}?session={session_id}&role=connector"
    try:
        ws = websocket.create_connection(ws_url, timeout=30)
        _relay_sessions[session_id] = ws

        session_dir = os.path.join(TEMP_DIR, session_id)
        os.makedirs(session_dir, exist_ok=True)

        filepath = None
        file_handle = None
        filename = f"file_{session_id}"
        total_received = 0

        print(f"  Connected to relay for session {session_id}")

        ws.settimeout(120)

        while True:
            data = ws.recv()

            if isinstance(data, str) and data.startswith("{"):
                try:
                    msg = json.loads(data)
                    if msg.get("type") == "metadata":
                        filename = msg.get("fileName", filename)
                        filepath = os.path.join(session_dir, filename)
                        file_handle = open(filepath, "wb")
                        total_received = 0
                        if DB:
                            try:
                                DB.collection("stream_sessions").document(
                                    session_id
                                ).update(
                                    {
                                        "status": "streaming",
                                        "progress": 0,
                                    }
                                )
                            except:
                                pass
                        print(
                            f"  Receiving file '{filename}' via relay for session {session_id}"
                        )
                    elif msg.get("type") == "relay:ping":
                        ws.send(json.dumps({"type": "relay:pong"}))
                    continue
                except:
                    pass

            if file_handle:
                chunk = data if isinstance(data, bytes) else data.encode()
                file_handle.write(chunk)
                total_received += len(chunk)

                if DB and total_received % (256 * 1024) < len(chunk):
                    try:
                        doc_ref = DB.collection("stream_sessions").document(session_id)
                        doc = doc_ref.get()
                        if doc.exists:
                            file_size = doc.to_dict().get("fileSize", 0)
                            if file_size > 0:
                                pct = min(99, int(total_received / file_size * 100))
                                doc_ref.update({"progress": pct})
                    except:
                        pass

            msg = None

    except Exception as e:
        print(f"  Relay receive error for session {session_id}: {e}")
    finally:
        if file_handle:
            file_handle.close()
            file_size = (
                os.path.getsize(filepath)
                if filepath and os.path.exists(filepath)
                else 0
            )
            print(f"  Saved {file_size} bytes to {filepath}")
            if DB:
                try:
                    DB.collection("stream_sessions").document(session_id).update(
                        {
                            "status": "completed",
                            "progress": 100,
                            "method": "relay",
                        }
                    )
                except:
                    pass

        _relay_sessions.pop(session_id, None)
        try:
            ws.close()
        except:
            pass


def watch_stream_sessions(db_instance, relay_url):
    global DB
    DB = db_instance

    def on_session_snapshot(doc_snapshot, changes, read_time):
        for change in changes:
            if change.type.name == "ADDED":
                session_id = change.document.id
                data = change.document.to_dict()
                if not data:
                    continue
                status = data.get("status", "")
                method = data.get("method", "")

                if session_id in _relay_sessions:
                    continue

                if method == "relay" or status == "pending":
                    print(
                        f"  Detected stream session {session_id} (method={method}, status={status})"
                    )
                    if relay_url:
                        thread = threading.Thread(
                            target=connect_relay_for_session,
                            args=(session_id, relay_url),
                            name=f"relay-{session_id[:8]}",
                            daemon=True,
                        )
                        thread.start()

    try:
        query = db_instance.collection("stream_sessions").where(
            filter=firestore.FieldFilter(
                "status", "in", ["pending", "connecting", "streaming"]
            )
        )
        watch = query.on_snapshot(on_session_snapshot)
        return watch
    except Exception as e:
        print(f"  Warning: Stream session listener error: {e}")
        return None


def init_receiver(
    temp_dir, db_instance, relay_url, printer_ids=None, host=None, port=None
):
    global TEMP_DIR, DB, RELATED_URL, PRINTER_IDS, HOST, PORT
    TEMP_DIR = temp_dir
    DB = db_instance
    RELATED_URL = relay_url
    PRINTER_IDS = printer_ids or []
    if host:
        HOST = host
    if port:
        PORT = port

    os.makedirs(TEMP_DIR, exist_ok=True)

    http_server = start_http_server(HOST, PORT)

    watch = watch_stream_sessions(db_instance, relay_url)

    print(
        f" Receiver initialized. HTTP on {HOST}:{PORT}, relay: {relay_url or 'not configured'}"
    )

    local_ip = get_local_ip()
    if watch is not None and printer_ids and db_instance:
        try:
            batch = db_instance.batch()
            for pid in printer_ids:
                ref = db_instance.collection("printers").document(pid)
                batch.update(
                    ref,
                    {
                        "connectorHost": local_ip,
                        "connectorPort": PORT,
                        "lastSeen": firestore.SERVER_TIMESTAMP,
                    },
                )
            from firebase_admin import firestore as _fs

            batch.commit()
            print(
                f"  Registered connector at {local_ip}:{PORT} for printers: {printer_ids}"
            )
        except Exception as e:
            print(f"  Could not register connector in Firestore: {e}")

    return http_server, watch
