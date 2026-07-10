

'use server';

import { collection, addDoc, serverTimestamp, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./config";
import type { PrintJob, Printer, Pricing } from "@/lib/types";
import { GoogleAuth } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';

const defaultPricing: Pricing = {
  bwA4First10Pages: 10,
  bwA4First10Price: 2,
  bwA4After10Price: 1, 
  coverPageFee: 2,
  colorA4Price: 10,
  bwA3Price: 10,
  colorA3Price: 30,
  bwA2Price: 50,
  bwA1Price: 100,
  bwA0Price: 200,
  colorA2Price: 100,
  colorA1Price: 200,
  colorA0Price: 400,
  spiralBindingFee: 40,
  softBindingFee: 25,
  editFee: 15.0,
};

const DRIVE_FOLDER_ID = '0AAg0HgehhXVRUk9PVA';
const DRIVE_SERVICE_ACCOUNT_KEY_PATH = 'driveServiceAccountKey.json';

async function getAuth() {
    const auth = new GoogleAuth({
        keyFile: DRIVE_SERVICE_ACCOUNT_KEY_PATH,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return auth;
}

export async function getGoogleDriveUploadUrl(fileName: string, mimeType: string, origin: string): Promise<{ success: boolean; uploadUrl?: string; uniqueFileName?: string; message?: string }> {
    try {
        const auth = await getAuth();
        const accessToken = await auth.getAccessToken();

        // Create a unique name that the local connector can find.
        const uniqueFileName = `${new Date().toISOString().replace(/[:.]/g, '-')}_${fileName}`;

        const fileMetadata = {
            name: uniqueFileName,
            parents: [DRIVE_FOLDER_ID],
        };
        
        const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': mimeType,
                 'Origin': origin,
            },
            body: JSON.stringify(fileMetadata),
        });
        
        if (!res.ok) {
            const errorText = await res.text();
            console.error('Google Drive resumable init failed:', errorText);
            throw new Error(`Failed to create resumable session: ${res.status} ${errorText}`);
        }
        
        const location = res.headers.get('Location');
        if (!location) {
            throw new Error('Could not get resumable upload URL (Location header) from Google Drive.');
        }

        return { success: true, uploadUrl: location, uniqueFileName: uniqueFileName };

    } catch (e: any) {
        console.error("Error getting Google Drive upload URL:", e);
        return { success: false, message: e.message || 'Could not get Google Drive upload URL.' };
    }
}


export async function createPrintJob(job: Omit<PrintJob, 'id' | 'createdAt'>): Promise<{success: boolean, id?: string, message?: string}> {
  try {
    const docRef = await addDoc(collection(db, "print_jobs"), {
      ...job,
      createdAt: serverTimestamp(),
    });
    console.log("Document created with ID: ", docRef.id);
    return { success: true, id: docRef.id };
  } catch (e: any) {
    console.error("Error adding document: ", e);
    return { success: false, message: e.message || 'Could not create print job in database.' };
  }
}

export async function updatePrintJobStatus(jobId: string, status: PrintJob['status'], errorMessage?: string): Promise<{ success: boolean; message?: string }> {
  if (!jobId) {
    return { success: false, message: 'Job ID is missing.' };
  }
  try {
    const jobRef = doc(db, "print_jobs", jobId);
    const updateData: any = {
      status: status,
    };
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }
    await updateDoc(jobRef, updateData);
    return { success: true };
  } catch (e: any) {
    console.error(`Error updating job ${jobId}: `, e);
    return { success: false, message: e.message || 'Could not update job status.' };
  }
}


export async function createTestPrintJob(printerId: string, printerName: string): Promise<{success: boolean, message?: string}> {
    if (!printerId) {
        return { success: false, message: 'Printer ID is missing.' };
    }
    try {
        const testJob: Partial<PrintJob> = {
            orderType: 'test-page',
            status: 'ready',
            printerId: printerId,
            name: printerName,
            cost: 0,
            username: 'Admin',
            orderId: 'TEST',
            files: [{
                fileName: 'Test Print',
                originalFileName: 'test-page.txt',
                googleDriveFileId: 'none', // Not applicable
                isWordFile: false,
                isImageFile: false,
                pageCount: 1,
                pageRange: 'all',
                copies: 1,
                printType: 'bw',
                paperSize: 'A4',
                orientation: 'portrait',
                duplex: 'one-sided'
            }]
        };

        const docRef = await addDoc(collection(db, "print_jobs"), {
            ...testJob,
            createdAt: serverTimestamp(),
        });
        console.log("Test print job created with ID: ", docRef.id);
        return { success: true, message: `Test page sent to printer ${printerName}` };
    } catch (e: any) {
        console.error("Error creating test print job: ", e);
        return { success: false, message: 'Could not create test print job.' };
    }
}


export async function getPricing(): Promise<Pricing> {
  const docRef = doc(db, "settings", "pricing");
  try {
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      // Merge defaults with fetched data to ensure all fields are present.
      return { ...defaultPricing, ...data } as Pricing;
    } else {
      // If the document doesn't exist at all, create it.
      await setDoc(docRef, defaultPricing);
      return defaultPricing;
    }
  } catch (e) {
    console.error("Error fetching pricing: ", e);
    // On read error, cautiously try to set defaults to self-heal for next time.
    try {
      await setDoc(docRef, defaultPricing);
    } catch (writeError) {
      console.error("Error setting default pricing after fetch failure: ", writeError);
    }
    return defaultPricing;
  }
}

export async function updatePricing(newPricing: Pricing): Promise<{ success: boolean; message?: string }> {
  try {
    const docRef = doc(db, "settings", "pricing");
    await setDoc(docRef, newPricing);
    return { success: true };
  } catch (e: any) {
    console.error("Error updating pricing: ", e);
    return { success: false, message: e.message || "Could not update pricing settings." };
  }
}

export async function updatePrinterCapabilities(printerId: string, capabilities: Printer['capabilities']): Promise<{ success: boolean; message?: string }> {
    if (!printerId) {
        return { success: false, message: 'Printer ID is missing.' };
    }
    try {
        const printerRef = doc(db, "printers", printerId);
        await updateDoc(printerRef, {
            capabilities: capabilities
        });
        return { success: true };
    } catch (e: any) {
        console.error(`Error updating printer capabilities for ${printerId}: `, e);
        return { success: false, message: e.message || 'Could not update printer capabilities.' };
    }
}

export async function getPageCountForWordFile(googleDriveFileId: string, uniqueFileName: string): Promise<{success: boolean; jobId?: string; message?: string}> {
    try {
        const jobData: Partial<PrintJob> = {
            orderType: 'page-count-request',
            status: 'page-count-request',
            files: [], // Not needed for this request type, but good to have
            cost: 0,
            username: 'page-count-service',
            orderId: 'page-count-service',
            // Add the specific fields for this job type
            fileName: uniqueFileName,
            googleDriveFileId: googleDriveFileId,
        };
        const creationResult = await createPrintJob(jobData as any);
        if (!creationResult.success || !creationResult.id) {
            throw new Error(creationResult.message || 'Could not create page count request job.');
        }
        return { success: true, jobId: creationResult.id };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}
