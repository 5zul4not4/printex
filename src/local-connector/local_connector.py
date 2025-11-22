
import os
import time
import threading
import firebase_admin
from firebase_admin import credentials, firestore
import win32print
import datetime
import subprocess
import re
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError
import io
try:
    from PyPDF2 import PdfReader, PdfWriter
except ImportError:
    from PyPDF2 import PdfFileReader as PdfReader, PdfFileWriter as PdfWriter
from PIL import Image
import win32com.client
import pythoncom # Required for multithreading COM objects

# === CONFIGURATION ===
FIREBASE_SERVICE_ACCOUNT_KEY_PATH = 'serviceAccountKey.json'
TEMP_DIR = "printed_jobs"
PRINTER_REFRESH_INTERVAL = 20 # seconds

DRIVE_SERVICE_ACCOUNT_KEY_PATH = 'driveServiceAccountKey.json'
DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive']
DRIVE_FOLDER_ID = '0AAg0HgehhXVRUk9PVA' # Replace with your Google Drive Folder ID

# A4 paper size in inches for layout calculations
A4_WIDTH_IN = 8.27
A4_HEIGHT_IN = 11.69
DPI = 300 # Standard print quality
AVG_SECONDS_PER_JOB = 120 # 2 minutes per job for wait time estimation

# === INITIALIZATION ===
try:
    cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_KEY_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Firebase Firestore initialized successfully.")
except Exception as e:
    print(f"❌ Error initializing Firebase: {e}")
    sys.exit(1)

drive_service = None
try:
    drive_creds = service_account.Credentials.from_service_account_file(
        DRIVE_SERVICE_ACCOUNT_KEY_PATH, scopes=DRIVE_SCOPES)
    drive_service = build('drive', 'v3', credentials=drive_creds)
    print("✅ Google Drive service initialized successfully.")
except FileNotFoundError:
    print(f"⚠️ WARNING: Google Drive service account key not found at '{DRIVE_SERVICE_ACCOUNT_KEY_PATH}'. File operations will fail.")
except Exception as e:
    print(f"❌ Error initializing Google Drive service: {e}")


# === GLOBALS ===
processed_jobs = set()
shutdown_event = threading.Event()

# === PRINTER MANAGEMENT ===
def sanitize_for_firestore_id(name):
    """Replaces invalid characters for Firestore document IDs."""
    name = re.sub(r'[\\/\s\(\)]', '_', name)
    name = re.sub(r'[^a-zA-Z0-9_.-]', '', name)
    if not name:
        return "invalid_printer_name"
    return name

def get_installed_printers():
    printers = win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL, None, 1)
    return [p[2] for p in printers]

def update_printers_in_firestore():
    """
    Updates the status, queue length, and estimated wait time for each
    printer managed by this connector instance.
    """
    try:
        printer_names = get_installed_printers()
        printers_ref = db.collection('printers')
        print(f"🖨️  Checking for printers... Found: {', '.join(printer_names)}")

        for name in printer_names:
            printer_doc_id = sanitize_for_firestore_id(name)
            
            # Get the current queue length for this specific printer
            try:
                query = db.collection('print_jobs').where(
                    filter=firestore.And(filters=[
                        firestore.FieldFilter('printerId', '==', printer_doc_id),
                        firestore.FieldFilter('status', 'in', ['ready', 'printing'])
                    ])
                )
                queue_snapshot = query.get()
                queue_length = len(queue_snapshot)
            except Exception as e:
                print(f"⚠️ Could not get queue length for {name}: {e}")
                queue_length = 0 # Default to 0 on error
            
            estimated_wait_time = queue_length * AVG_SECONDS_PER_JOB

            printer_doc = printers_ref.document(printer_doc_id)
            doc_snapshot = printer_doc.get()
            
            update_data = {
                'status': 'online',
                'lastSeen': firestore.SERVER_TIMESTAMP,
                'queueLength': queue_length,
                'estimatedWaitTime': estimated_wait_time,
            }
            
            if doc_snapshot.exists:
                printer_doc.update(update_data)
            else:
                print(f"✨ Found new printer, adding to Firestore: {name}")
                # For new printers, also set the name and initial capabilities
                initial_data = {
                    'name': name,
                    'capabilities': ['bw', 'color', 'A4', 'A3', 'A2', 'A1', 'A0', 'duplex', 'single-sided'],
                    **update_data
                }
                printer_doc.set(initial_data)

    except Exception as e:
        print(f"⚠️ Could not update printers in Firestore: {e}")

# === FILE PROCESSING & PRINTING ===
def download_file_from_drive(file_id, local_path):
    """Downloads a file from Google Drive using its file ID."""
    if not drive_service:
        raise Exception("Google Drive service not available for download.")
    try:
        # First, get file metadata to ensure it exists and we have permissions.
        # This can help stabilize the connection before the download begins.
        print(f"⬇️  Verifying Google Drive file (ID: {file_id})...")
        drive_service.files().get(fileId=file_id, supportsAllDrives=True).execute()
        
        print(f"⬇️  Downloading from Google Drive...")
        request = drive_service.files().get_media(fileId=file_id, supportsAllDrives=True)
        fh = io.FileIO(local_path, 'wb')
        downloader = MediaIoBaseDownload(fh, request)
        
        done = False
        while not done:
            status, done = downloader.next_chunk()
            if status:
                print(f"   Download {int(status.progress() * 100)}%.")
        
        print(f"✅ File downloaded successfully to '{os.path.basename(local_path)}'")
        return local_path
        
    except HttpError as error:
        if error.resp.status == 404:
             raise Exception(f"File not found in Google Drive (ID: {file_id}). It may have been deleted or the ID is incorrect.")
        raise Exception(f"Google Drive API error: {error}")
    except Exception as e:
        # This will catch other errors, including potential WinError exceptions
        raise Exception(f"Failed during file download: {e}")


def create_image_layout_pdf(image_path, copies, layout_info, print_type, orientation, output_pdf_path):
    """Creates a PDF with multiple copies of a single image on one or more pages."""
    layout_type = layout_info.get('type', 'full-page')
    fit_mode = layout_info.get('fit', 'contain')
    
    print(f"🎨 Creating collage '{layout_type}' for {copies} copies of one photo...")

    try:
        if orientation == 'landscape':
            a4_pixel_width, a4_pixel_height = int(A4_HEIGHT_IN * DPI), int(A4_WIDTH_IN * DPI)
        else: # Portrait
            a4_pixel_width, a4_pixel_height = int(A4_WIDTH_IN * DPI), int(A4_HEIGHT_IN * DPI)

        grid_cols, grid_rows = 1, 1
        if layout_type == '2-up': grid_cols, grid_rows = (2, 1) if orientation == 'landscape' else (1, 2)
        elif layout_type == '4-up': grid_cols, grid_rows = 2, 2
        elif layout_type == '9-up': grid_cols, grid_rows = 3, 3
        elif layout_type == 'contact-sheet': grid_cols, grid_rows = (7, 5) if orientation == 'landscape' else (5, 7)
        
        photos_per_page = grid_cols * grid_rows
        total_pages_needed = (copies + photos_per_page - 1) // photos_per_page # Ceiling division

        cell_width = a4_pixel_width // grid_cols
        cell_height = a4_pixel_height // grid_rows

        source_image = Image.open(image_path)
        if print_type == 'bw':
            source_image = source_image.convert('L').convert('RGB')
        
        # Resize the source image to fit the cell once
        resized_image = source_image.copy()
        if fit_mode == 'contain':
            resized_image.thumbnail((cell_width, cell_height), Image.Resampling.LANCZOS)
        else: # 'cover'
            img_aspect, cell_aspect = resized_image.width / resized_image.height, cell_width / cell_height
            if img_aspect > cell_aspect:
                new_height, new_width = cell_height, int(cell_height * img_aspect)
            else:
                new_width, new_height = cell_width, int(cell_width / img_aspect)
            resized_image = resized_image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            left, top = (new_width - cell_width) / 2, (new_height - cell_height) / 2
            resized_image = resized_image.crop((left, top, left + cell_width, top + cell_height))

        pdf_pages = []
        copies_placed = 0
        
        for _ in range(total_pages_needed):
            page_canvas = Image.new('RGB', (a4_pixel_width, a4_pixel_height), 'white')
            
            for i in range(photos_per_page):
                if copies_placed >= copies:
                    break
                
                row, col = (i // grid_cols), (i % grid_cols)
                paste_x = col * cell_width + (cell_width - resized_image.width) // 2
                paste_y = row * cell_height + (cell_height - resized_image.height) // 2
                page_canvas.paste(resized_image, (paste_x, paste_y))
                copies_placed += 1
            
            pdf_pages.append(page_canvas)

        if pdf_pages:
            pdf_pages[0].save(output_pdf_path, "PDF", resolution=DPI, save_all=True, append_images=pdf_pages[1:])
        
        print(f"✅ Saved collage PDF to '{os.path.basename(output_pdf_path)}'")
        
    except Exception as e:
        raise Exception(f"Failed to create image collage PDF: {e}")


def convert_to_pdf(input_path, word_app):
    """Converts various file types to PDF. A word_app instance must be provided for doc/docx/txt."""
    file_ext = os.path.splitext(input_path)[1].lower()
    output_path = os.path.splitext(input_path)[0] + "_converted.pdf"

    if file_ext == '.pdf':
        return input_path  # No conversion needed

    try:
        if file_ext in ['.doc', '.docx', '.txt']:
            if not word_app:
                raise Exception("Word application instance not provided for document conversion.")
            
            print(f"🔄 Converting document using MS Word: {os.path.basename(input_path)}")
            doc = None
            doc = word_app.Documents.Open(os.path.abspath(input_path))
            doc.SaveAs(os.path.abspath(output_path), FileFormat=17)  # 17 = wdFormatPDF
            doc.Close(False) # Close without saving changes
            print("✅ Document to PDF conversion successful.")
        
        elif file_ext in ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff']:
            print(f"🖼️  Converting image to PDF: {os.path.basename(input_path)}")
            image = Image.open(input_path)
            # Create a new blank A4 page and paste the image onto it
            a4_pixel_width = int(A4_WIDTH_IN * DPI)
            a4_pixel_height = int(A4_HEIGHT_IN * DPI)
            
            # If image is larger than A4, scale it down to fit
            image.thumbnail((a4_pixel_width, a4_pixel_height), Image.Resampling.LANCZOS)
            
            a4_page = Image.new('RGB', (a4_pixel_width, a4_pixel_height), 'white')
            # Center the image on the page
            paste_x = (a4_pixel_width - image.width) // 2
            paste_y = (a4_pixel_height - image.height) // 2
            a4_page.paste(image, (paste_x, paste_y))
            
            a4_page.save(output_path, "PDF", resolution=DPI)
            print("✅ Image to PDF conversion successful.")
        
        else:
            raise Exception(f"Unsupported file type for conversion: {file_ext}")

        return output_path
    except Exception as e:
        if 'win32com' in str(e):
             raise Exception(f"MS Word conversion failed for '{os.path.basename(input_path)}'. Ensure Word is installed and not busy. Error: {e}")
        raise Exception(f"Conversion to PDF failed for '{os.path.basename(input_path)}': {e}")


def get_pdf_page_count(pdf_path):
    try:
        with open(pdf_path, 'rb') as f:
            reader = PdfReader(f)
            return len(reader.pages)
    except Exception as e:
        raise Exception(f"Failed to count pages in PDF: {e}")

def find_sumatra():
    """Locate SumatraPDF executable automatically."""
    possible_paths = [
        os.path.join(os.environ.get("ProgramFiles", ""), "SumatraPDF", "SumatraPDF.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "SumatraPDF", "SumatraPDF.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "SumatraPDF", "SumatraPDF.exe"),
        r"C:\\Users\\DELL\\AppData\\Local\\SumatraPDF\\SumatraPDF.exe",
    ]
    for path in possible_paths:
        if os.path.exists(path): return path
    return None

def print_file(printer_name, file_path, job_id, copies=1, duplex_mode='one-sided', page_range_str='', orientation='portrait', paper_size='A4'):
    sumatra_path = find_sumatra()
    if not sumatra_path:
        raise Exception("SumatraPDF not found. Please install it.")

    try:
        print(f"🖨️  Printing '{os.path.basename(file_path)}' for job {job_id}...")
        
        settings = [f"{copies}x"]
        
        # Set duplexing based on the mode provided from Firestore
        if duplex_mode == 'duplex-long-edge':
            settings.append("duplex")
        elif duplex_mode == 'duplex-short-edge':
            settings.append("duplexshort")
        else: # 'one-sided' or any other value
            settings.append("simplex")

        # Always add orientation to prevent manual tray selection
        if orientation == 'landscape':
            settings.append("landscape")
        else: # Default to portrait
            settings.append("portrait")
            
        # Always add paper size to ensure correct tray selection
        settings.append(f"papersize={paper_size}")

        if page_range_str and page_range_str.lower() != 'all':
            settings.append(page_range_str)

        command = [sumatra_path, "-print-to", printer_name, "-silent", "-exit-on-print"]
        # Filter out any empty settings and join them
        final_settings = ",".join(filter(None, settings))
        if final_settings:
            command.extend(["-print-settings", final_settings])
        command.append(file_path)
        
        print(f"   Executing command: {' '.join(command)}")
        result = subprocess.run(command, capture_output=True, text=True, check=False)

        if result.returncode != 0:
            raise Exception(f"SumatraPDF Error: {result.stderr.strip() if result.stderr else 'Unknown error'}")

        print(f"✅ Job {job_id} sent to printer successfully.")
        return True
    except Exception as e:
        raise Exception(f"Printing failed: {e}")
        
def parse_page_range(range_str, max_pages):
    """Parses a page range string (e.g., '1-3,5,7') into a list of 0-indexed page numbers."""
    if not range_str or range_str.lower() == 'all':
        return list(range(max_pages))
    
    pages = set()
    parts = range_str.split(',')
    for part in parts:
        part = part.strip()
        if '-' in part:
            start_str, end_str = part.split('-')
            if start_str.isdigit() and end_str.isdigit():
                start, end = int(start_str), int(end_str)
                for i in range(start, end + 1):
                    if 1 <= i <= max_pages:
                        pages.add(i - 1)
        elif part.isdigit():
            page_num = int(part)
            if 1 <= page_num <= max_pages:
                pages.add(page_num - 1)
    return sorted(list(pages))

# === JOB PROCESSORS ===

def process_page_count_request(job_id, job_data):
    print(f"\n--- Processing page count request {job_id} ---")
    job_ref = db.collection('print_jobs').document(job_id)
    local_file_path = None
    pdf_path = None
    word = None

    try:
        pythoncom.CoInitialize() # Initialize COM for this thread
        drive_file_id = job_data.get('googleDriveFileId')
        unique_file_name = job_data.get('fileName') 
        
        if not drive_file_id:
            raise Exception("Missing Google Drive File ID in page count request.")

        local_file_path = os.path.join(TEMP_DIR, f"{job_id}_{unique_file_name}")
        download_file_from_drive(drive_file_id, local_file_path)

        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False

        pdf_path = convert_to_pdf(local_file_path, word_app=word)
        page_count = get_pdf_page_count(pdf_path)

        job_ref.update({'status': 'page-count-completed', 'pageCount': page_count})
        print(f"✅ Page count for job {job_id} is {page_count}. Updated Firestore.")

    except Exception as e:
        print(f"❌ Job {job_id} failed: {e}")
        job_ref.update({'status': 'error', 'error_message': str(e)})
    finally:
        if word:
            word.Quit()
        if local_file_path and os.path.exists(local_file_path): os.remove(local_file_path)
        if pdf_path and pdf_path != local_file_path and os.path.exists(pdf_path): os.remove(pdf_path)
        processed_jobs.discard(job_id)
        pythoncom.CoUninitialize() # Uninitialize COM for this thread

def process_print_job(job_id, job_data):
    print(f"\n--- Processing print job {job_id} ---")
    job_ref = db.collection('print_jobs').document(job_id)
    temp_files_to_clean = []
    word = None
    
    try:
        pythoncom.CoInitialize() # Initialize COM for this thread
        job_ref.update({'status': 'printing'})

        files_to_process = job_data.get('files', [])
        if not files_to_process:
            raise Exception("No files found in the job.")
        
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False

        # --- Cover Page Printing ---
        binding = job_data.get('binding')
        has_documents = any(not f.get('isImageFile', False) for f in files_to_process)
        
        if binding in ['spiral', 'soft'] and has_documents:
            print("ℹ️ Binding detected. Printing cover page first...")
            cover_page_text_path = os.path.join(TEMP_DIR, f"{job_id}_cover.txt")
            temp_files_to_clean.append(cover_page_text_path)
            
            with open(cover_page_text_path, 'w', encoding='utf-8') as f:
                f.write("========= PrintEase Order Summary =========\n\n")
                f.write(f"Order ID: {job_data.get('orderId', 'N/A')}\n")
                f.write(f"Customer Name: {job_data.get('username', 'N/A')}\n")
                f.write(f"Date: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
                f.write("-------------------------------------------\n")
                f.write(f"Binding: {binding.capitalize() if binding else 'None'}\n")
                f.write(f"Total Files: {len(files_to_process)}\n\n")
                f.write("-------------------------------------------\n\n")
                for i, f_info in enumerate(files_to_process):
                    f.write(f"{i+1}. {f_info.get('originalFileName')}\n")
                    f.write(f"   - Copies: {f_info.get('copies', 1)}\n")
                    f.write("\n")

            cover_pdf_path = convert_to_pdf(cover_page_text_path, word_app=word)
            if cover_pdf_path != cover_page_text_path: temp_files_to_clean.append(cover_pdf_path)

            print_file(
                printer_name=job_data.get('name'),
                file_path=cover_pdf_path,
                job_id=f"{job_id}-cover",
                copies=1,
                paper_size='A4',
                orientation='portrait',
                duplex_mode='one-sided'
            )
            print("✅ Cover page sent to printer.")

        # --- Individual File Printing Loop ---
        for i, file_info in enumerate(files_to_process):
            file_specific_temp_files = []
            try:
                original_file_name = file_info.get('originalFileName', f'file_{i+1}')
                is_image = file_info.get('isImageFile', False)
                print(f"\n📄 Processing file {i+1}/{len(files_to_process)}: {original_file_name}")

                drive_file_id = file_info.get('googleDriveFileId')
                if not drive_file_id: raise Exception(f"Missing Google Drive ID for file '{original_file_name}'.")

                local_path = os.path.join(TEMP_DIR, f"{job_id}_{i}_{original_file_name}")
                file_specific_temp_files.append(local_path)
                download_file_from_drive(drive_file_id, local_path)
                
                final_pdf_for_this_file = None
                desired_orientation = file_info.get('orientation', 'portrait')
                copies = file_info.get('copies', 1)
                
                if is_image:
                    layout_info = file_info.get('imageLayout')
                    layout_type = layout_info.get('type', 'full-page') if layout_info else 'full-page'
                    
                    if layout_type == 'full-page':
                        # For full-page, just convert the single image to a PDF. The copies will be handled by the print command.
                        converted_pdf = convert_to_pdf(local_path, word_app=word)
                        if converted_pdf != local_path: file_specific_temp_files.append(converted_pdf)
                        final_pdf_for_this_file = converted_pdf
                    else:
                        # For collages, create a PDF with the specified number of image copies laid out on pages.
                        collage_pdf_path = os.path.join(TEMP_DIR, f"{job_id}_collage_{i}.pdf")
                        file_specific_temp_files.append(collage_pdf_path)
                        
                        create_image_layout_pdf(
                            image_path=local_path,
                            copies=copies,
                            layout_info=layout_info,
                            print_type=file_info.get('printType'),
                            orientation=desired_orientation,
                            output_pdf_path=collage_pdf_path
                        )
                        final_pdf_for_this_file = collage_pdf_path
                        # For collages, the PDF itself contains all copies, so the printer should only print it once.
                        copies = 1 
                else: # Document file
                    converted_pdf_path = convert_to_pdf(local_path, word_app=word)
                    if converted_pdf_path != local_path: file_specific_temp_files.append(converted_pdf_path)

                    rotated_pdf_path_for_doc = converted_pdf_path
                    # --- Orientation and Rotation Logic for Documents ---
                    print(f"   Desired orientation: {desired_orientation}")
                    reader = PdfReader(converted_pdf_path)
                    if len(reader.pages) > 0:
                        first_page = reader.pages[0]
                        media_box = first_page.mediabox
                        
                        source_is_portrait = media_box.height > media_box.width
                        source_orientation = 'portrait' if source_is_portrait else 'landscape'
                        print(f"   Detected source orientation: {source_orientation}")

                        if source_orientation != desired_orientation:
                            print(f"   🔄 Rotating from {source_orientation} to {desired_orientation}...")
                            rotated_pdf_path = os.path.join(TEMP_DIR, f"{job_id}_{i}_rotated.pdf")
                            file_specific_temp_files.append(rotated_pdf_path)
                            writer = PdfWriter()
                            for page in reader.pages:
                                page.rotate(90)
                                writer.add_page(page)
                            
                            with open(rotated_pdf_path, 'wb') as f_out:
                                writer.write(f_out)
                            
                            rotated_pdf_path_for_doc = rotated_pdf_path
                            print(f"   ✅ Created rotated PDF: {os.path.basename(rotated_pdf_path)}")
                    
                    # Apply page range selection
                    page_range_str = file_info.get('pageRange', 'all')
                    if page_range_str and page_range_str.lower() != 'all':
                        subset_pdf_path = os.path.join(TEMP_DIR, f"{job_id}_{i}_subset.pdf")
                        file_specific_temp_files.append(subset_pdf_path)
                        
                        with open(rotated_pdf_path_for_doc, 'rb') as f_in:
                            reader = PdfReader(f_in)
                            writer = PdfWriter()
                            pages_to_include = parse_page_range(page_range_str, len(reader.pages))
                            for page_index in pages_to_include:
                                writer.add_page(reader.pages[page_index])
                            
                            with open(subset_pdf_path, 'wb') as f_out:
                                writer.write(f_out)
                        
                        final_pdf_for_this_file = subset_pdf_path
                        print(f"   Applied page range '{page_range_str}', created subset PDF.")
                    else:
                        final_pdf_for_this_file = rotated_pdf_path_for_doc

                print_file(
                    printer_name=job_data.get('name'),
                    file_path=final_pdf_for_this_file,
                    job_id=f"{job_id}-{i+1}",
                    copies=copies,
                    duplex_mode=file_info.get('duplex', 'one-sided'),
                    orientation=desired_orientation,
                    paper_size=file_info.get('paperSize', 'A4')
                )
            
            finally:
                # Clean up temporary files for this specific file
                for f in file_specific_temp_files:
                    if os.path.exists(f):
                        try: os.remove(f)
                        except Exception as e: print(f"Could not remove temp file {f}: {e}")

        # Decide final status based on whether it was a reprint
        is_reprint = job_data.get('isReprint', False)
        final_status = 'reprint-completed' if is_reprint else 'completed'

        job_ref.update({'status': final_status, 'printedAt': firestore.SERVER_TIMESTAMP})
        print(f"🎉 All files for job {job_id} have been processed. Final status: {final_status}.")

    except Exception as e:
        print(f"❌ Job {job_id} failed: {e}")
        job_ref.update({'status': 'error', 'error_message': str(e)})
    finally:
        if word:
            word.Quit()
        for f in temp_files_to_clean:
            if os.path.exists(f):
                try: os.remove(f)
                except Exception as e: print(f"Could not remove temp file {f}: {e}")
            
        processed_jobs.discard(job_id)
        pythoncom.CoUninitialize() # Uninitialize COM for this thread


def create_test_page_file(job_id, printer_name):
    """Creates a text file for a test print job."""
    local_path = os.path.join(TEMP_DIR, f"{job_id}_test_page.txt")
    with open(local_path, 'w', encoding='utf-8') as f:
        f.write(f"--- PrintEase Test Page ---\n\nJob ID: {job_id}\nPrinter: {printer_name}\nTimestamp: {datetime.datetime.now()}\n\n✅ This is a test print from the PrintEase Local Connector.\n")
    return local_path

def process_test_job(job_id, job_data):
    print(f"\n--- Processing test job {job_id} ---")
    job_ref = db.collection('print_jobs').document(job_id)
    local_file_path, pdf_path, word = None, None, None
    try:
        pythoncom.CoInitialize() # Initialize COM for this thread
        job_ref.update({'status': 'printing'})
        printer_name = job_data.get('name')
        local_file_path = create_test_page_file(job_id, printer_name)
        
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False

        pdf_path = convert_to_pdf(local_file_path, word_app=word)
        print_file(
            printer_name=printer_name, 
            file_path=pdf_path, 
            job_id=job_id, 
            copies=1, 
            duplex_mode='one-sided', 
            orientation='portrait', 
            paper_size='A4'
        )
        job_ref.update({'status': 'completed', 'printedAt': firestore.SERVER_TIMESTAMP})
    except Exception as e:
         print(f"❌ Test Job {job_id} failed: {e}")
         job_ref.update({'status': 'error', 'error_message': str(e)})
    finally:
        if word: word.Quit()
        if local_file_path and os.path.exists(local_file_path): os.remove(local_file_path)
        if pdf_path and pdf_path != local_file_path and os.path.exists(pdf_path): os.remove(pdf_path)
        processed_jobs.discard(job_id)
        pythoncom.CoUninitialize() # Uninitialize COM for this thread


# === FIRESTORE LISTENER ===
def on_new_job_snapshot(doc_snapshot, changes, read_time):
    for change in changes:
        if change.type.name in ("ADDED", "MODIFIED"):
            job_id, job_data = change.document.id, change.document.to_dict()
            status, order_type = job_data.get('status'), job_data.get('orderType')

            if job_id in processed_jobs: continue

            if status == 'ready':
                processed_jobs.add(job_id)
                if order_type == 'print':
                    print(f"🔔 Found new print order: {job_id}")
                    threading.Thread(target=process_print_job, args=(job_id, job_data), daemon=True).start()
                elif order_type == 'test-page':
                    print(f"🔔 Found new test print job: {job_id}")
                    threading.Thread(target=process_test_job, args=(job_id, job_data), daemon=True).start()
            elif status == 'page-count-request':
                processed_jobs.add(job_id)
                print(f"🔔 Found new page count request: {job_id}")
                threading.Thread(target=process_page_count_request, args=(job_id, job_data), daemon=True).start()

def start_job_listener():
    try:
        query = db.collection('print_jobs').where(filter=firestore.FieldFilter('status', 'in', ['ready', 'page-count-request']))
        return query.on_snapshot(on_new_job_snapshot)
    except Exception as e:
        print(f"⚠️ Firestore listener error: {e}")
        return None

# === MAIN ===
def main():
    print("--- PrintEase Local Connector ---")
    os.makedirs(TEMP_DIR, exist_ok=True)

    try:
        from PIL import Image
        import win32com.client
        from googleapiclient.discovery import build
    except ImportError as e:
        print(f"❌ Missing required library: {e.name}. Please run:\npip install Pillow pypiwin32 google-api-python-client PyPDF2")
        sys.exit(1)

    update_printers_in_firestore()

    print("👂 Listening for jobs...")
    job_watch = start_job_listener()
    if not job_watch:
        print("❌ Listener failed to start. Exiting.")
        sys.exit(1)

    try:
        print("✅ Connector running. Press Ctrl+C to exit.")
        last_printer_refresh = time.time()
        while not shutdown_event.is_set():
            if time.time() - last_printer_refresh > PRINTER_REFRESH_INTERVAL:
                update_printers_in_firestore()
                last_printer_refresh = time.time()
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Shutting down...")
    finally:
        if job_watch: job_watch.unsubscribe()
        shutdown_event.set()
        print("👋 Connector stopped.")

if __name__ == "__main__":
    main()


