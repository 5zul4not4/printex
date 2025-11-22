# PrintEase Local Connector Agent (Python)

This document provides instructions for setting up the Python-based Local Connector Agent, which runs on the print shop's Windows PC. This script is the bridge between your online application and your physical printers.

## 1. Purpose

The Local Connector's primary responsibilities are:
- **Connecting to Firebase**: Securely authenticates with your Firebase project.
- **Printer Management**: Detects all printers installed on the Windows machine and reports them to the Firestore `printers` collection so they appear in your admin dashboard.
- **Job Polling**: Actively polls for new print jobs in the `print_jobs` collection that have a `status` of `ready`.
- **File Downloading**: Downloads the print job file from Google Drive.
- **Printing**: Spools the document to the correct local printer using `SumatraPDF`.
- **Status Updates**: Updates the job's status in Firestore from `ready` -> `printing` -> `completed` or `error`.

## 2. Setup Instructions

### Prerequisites
- A Windows PC (Windows 7/10/11) with printers installed.
- Python 3.8 or newer installed. Download it from [python.org](https://www.python.org/downloads/).
- **SumatraPDF** must be installed. This is a lightweight, free PDF viewer that is excellent for silent printing via command line. Download it from [sumatrapdfreader.org](https://www.sumatrapdfreader.org/free-pdf-reader).

### 2.1. Firebase & Google Drive Service Account Keys

This project directory should already contain two critical `.json` key files. These were generated when the project was set up.
1.  `serviceAccountKey.json`: For connecting to Firebase Firestore.
2.  `driveServiceAccountKey.json`: For connecting to Google Drive to download files.

**IMPORTANT**: These files contain sensitive credentials. Do not share them or commit them to public version control.

### 2.2. Python Environment Installation

1.  **Open Command Prompt or PowerShell** on the Windows PC.
2.  **Navigate to this directory**:
    ```sh
    cd path\to\your\project\local-connector
    ```
3.  **Create a virtual environment** (recommended to keep dependencies isolated):
    ```sh
    python -m venv venv
    ```
4.  **Activate the virtual environment**:
    ```sh
    .\venv\Scripts\activate
    ```
5.  **Install the required Python libraries**:
    Run the following command to install all necessary packages from the `requirements.txt` file:
    ```sh
    pip install -r requirements.txt
    ```

## 3. Running the Agent

To run the agent, simply execute the Python script from your terminal (with the virtual environment activated):

```sh
python local_connector.py
```

The script will start, initialize Firebase and Google Drive services, report the printers it finds on the PC, and begin polling for jobs. You will see log messages in the console as it works.

For production use, you should consider running this script as a Windows Service or a scheduled task to ensure it's always running in the background.

---

### How it all works together:

1.  A **customer** visits your deployed website and places a print order.
2.  The Next.js app creates a `print_job` document in Firestore with a status of `ready`.
3.  The **`local_connector.py` script**, running on your shop's PC, sees this new job.
4.  The script downloads the file and sends it to the physical printer.
5.  The script updates the job's status to `completed`.
6.  You, the **admin**, can see the updated status on your dashboard.
