import { db } from '@/lib/firebase/config';
import { doc, setDoc, getDoc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';

export type StreamMethod = 'http' | 'webrtc' | 'relay';

export interface StreamResult {
  success: boolean;
  method: StreamMethod;
  message?: string;
}

const CHUNK_SIZE = 65536; // 64KB chunks
const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function createSessionDoc(sessionId: string, fileName: string, fileSize: number) {
  return setDoc(doc(db, 'stream_sessions', sessionId), {
    status: 'pending',
    progress: 0,
    fileName,
    fileSize,
    method: null,
    browserSdp: null,
    connectorSdp: null,
    browserIce: [],
    connectorIce: [],
    errorMessage: null,
    createdAt: serverTimestamp(),
  });
}

function updateSession(sessionId: string, data: Record<string, any>) {
  return updateDoc(doc(db, 'stream_sessions', sessionId), data);
}

function waitForCondition<T>(
  sessionId: string,
  field: string,
  timeoutMs: number = 30000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const unsub = onSnapshot(doc(db, 'stream_sessions', sessionId), (snap) => {
      const val = snap.data()?.[field] as T;
      if (val !== null && val !== undefined && val !== '') {
        unsub();
        resolve(val);
      }
    });
    setTimeout(() => {
      unsub();
      reject(new Error(`Timeout waiting for ${field}`));
    }, timeoutMs);
  });
}

// --- HTTP DIRECT ---

async function httpUpload(
  file: File,
  sessionId: string,
  host: string,
  port: number,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<boolean> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sessionId', sessionId);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `http://${host}:${port}/upload/${sessionId}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status === 200) resolve(true);
      else reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
    };

    xhr.onerror = () => reject(new Error('Network error during HTTP upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    signal.addEventListener('abort', () => xhr.abort());
    xhr.send(formData);
  });
}

// --- WEBRTC ---

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function webrtcUpload(
  file: File,
  sessionId: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<boolean> {
  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  const dc = pc.createDataChannel('filetransfer', {
    ordered: true,
    protocol: 'printex-stream',
  });

  let transferPromise: Promise<boolean>;
  let transferResolve: (ok: boolean) => void;
  let transferReject: (err: Error) => void;
  transferPromise = new Promise((res, rej) => {
    transferResolve = res;
    transferReject = rej;
  });

  dc.onopen = () => {
    sendFileViaDataChannel(dc, file, onProgress)
      .then(() => transferResolve(true))
      .catch(transferReject);
  };

  dc.onerror = (e) => transferReject(new Error('DataChannel error'));
  dc.onclose = () => transferReject(new Error('DataChannel closed before completion'));

  pc.onicecandidate = async (e) => {
    if (e.candidate) {
      const existing = await getDoc(doc(db, 'stream_sessions', sessionId));
      const candidates = existing.data()?.browserIce || [];
      candidates.push(e.candidate.toJSON());
      await updateSession(sessionId, { browserIce: candidates });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      transferReject(new Error(`WebRTC connection ${pc.connectionState}`));
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await updateSession(sessionId, {
      status: 'connecting',
      browserSdp: JSON.stringify(pc.localDescription),
      method: 'webrtc',
    });

    const connectorSdpStr = await waitForCondition<string>(sessionId, 'connectorSdp');
    const answerDesc = new RTCSessionDescription(JSON.parse(connectorSdpStr));
    await pc.setRemoteDescription(answerDesc);

    const result = await transferPromise;
    await updateSession(sessionId, { status: 'completed', progress: 100 });
    return result;
  } catch (e: any) {
    await updateSession(sessionId, { status: 'error', errorMessage: e.message }).catch(() => {});
    throw e;
  } finally {
    setTimeout(() => {
      dc.close();
      pc.close();
    }, 1000);
  }
}

async function sendFileViaDataChannel(
  dc: RTCDataChannel,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const fileSize = file.size;
    let offset = 0;

    const metadata = JSON.stringify({
      type: 'metadata',
      fileName: file.name,
      fileSize: fileSize,
      mimeType: file.type,
    });

    dc.send(metadata);

    reader.onerror = () => reject(new Error('FileReader error'));

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = async (e) => {
      const chunk = e.target?.result as ArrayBuffer;
      if (!chunk) {
        reject(new Error('Empty chunk'));
        return;
      }

      dc.send(chunk);
      offset += chunk.byteLength;
      const pct = Math.round((offset / fileSize) * 100);
      onProgress(pct);

      if (offset < fileSize) {
        if (dc.bufferedAmount > 1048576) {
          await new Promise((r) => { const check = setInterval(() => { if (dc.bufferedAmount < 524288) { clearInterval(check); r(); }}, 100); });
        }
        readNextChunk();
      } else {
        resolve();
      }
    };

    readNextChunk();
  });
}

// --- RELAY ---

function relayUpload(
  file: File,
  sessionId: string,
  relayUrl: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${relayUrl}?session=${sessionId}&role=browser`);

    ws.onopen = async () => {
      try {
        onProgress(0);
        const reader = new FileReader();
        const fileSize = file.size;
        let offset = 0;

        const metadata = JSON.stringify({
          type: 'metadata',
          fileName: file.name,
          fileSize: fileSize,
          mimeType: file.type,
        });
        ws.send(metadata);

        const readNextChunk = () => {
          const slice = file.slice(offset, offset + CHUNK_SIZE);
          reader.readAsArrayBuffer(slice);
        };

        reader.onload = () => {
          const chunk = reader.result as ArrayBuffer;
          ws.send(chunk);
          offset += chunk.byteLength;
          const pct = Math.round((offset / fileSize) * 100);
          onProgress(pct);

          if (offset < fileSize) {
            readNextChunk();
          }
        };

        reader.onerror = () => reject(new Error('FileReader error'));
        readNextChunk();
      } catch (e: any) {
        reject(e);
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'relay:connected') onProgress(1);
        if (msg.type === 'relay:complete') {
          onProgress(100);
          resolve(true);
        }
        if (msg.type === 'relay:error') reject(new Error(msg.message));
      } catch {}
    };

    ws.onerror = () => reject(new Error('Relay connection error'));
    ws.onclose = (e) => {
      if (e.code !== 1000) reject(new Error(`Relay disconnected: ${e.reason || 'unknown'}`));
    };

    signal.addEventListener('abort', () => ws.close());
  });
}

// --- PUBLIC API ---

export async function streamFileToConnector(
  file: File,
  sessionId: string,
  connectorHost: string | null,
  connectorPort: number | null,
  relayUrl: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<StreamResult> {
  await createSessionDoc(sessionId, file.name, file.size);

  if (connectorHost && connectorPort) {
    try {
      const result = await httpUpload(file, sessionId, connectorHost, connectorPort, onProgress, signal);
      if (result) return { success: true, method: 'http' };
    } catch (e: any) {
      console.warn('Direct HTTP upload failed, trying WebRTC...', e.message);
    }
  }

  try {
    const result = await webrtcUpload(file, sessionId, onProgress, signal);
    if (result) return { success: true, method: 'webrtc' };
  } catch (e: any) {
    console.warn('WebRTC failed, falling back to relay...', e.message);
  }

  try {
    const result = await relayUpload(file, sessionId, relayUrl, onProgress, signal);
    if (result) return { success: true, method: 'relay' };
  } catch (e: any) {
    console.error('All streaming methods failed', e.message);
  }

  await updateSession(sessionId, { status: 'error', errorMessage: 'All transfer methods failed' }).catch(() => {});
  return { success: false, method: 'http', message: 'All transfer methods failed' };
}

export async function getConnectorInfo(): Promise<{ host: string | null; port: number | null }> {
  try {
    const { collection, getDocs } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase/config');
    const snap = await getDocs(collection(db, 'printers'));
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.connectorHost && data.connectorPort) {
        return { host: data.connectorHost, port: data.connectorPort };
      }
    }
  } catch {}
  return { host: null, port: null };
}
