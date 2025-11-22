
'use server';

import { collection, addDoc, serverTimestamp, doc, getDoc, setDoc, updateDoc, getDocs, writeBatch, query, orderBy, limit } from "firebase/firestore";
import { db } from "./config";
import type { PrintJob, Printer, Pricing, PaperSizes } from "@/lib/types";
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import Razorpay from 'razorpay';
import crypto from 'crypto';

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

const defaultPaperSizes: PaperSizes = {
    A0: false,
    A1: false,
    A2: false,
    A3: true,
    A4: true,
};

const DRIVE_FOLDER_ID = '0AAg0HgehhXVRUk9PVA';
const MAX_JOBS_IN_COLLECTION = 1000;


async function getAuth() {
    if (!process.env.DRIVE_SERVICE_ACCOUNT_JSON) {
        throw new Error("DRIVE_SERVICE_ACCOUNT_JSON environment variable is not set.");
    }
    const credentials = JSON.parse(process.env.DRIVE_SERVICE_ACCOUNT_JSON);
    const auth = new GoogleAuth({
        credentials,
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

export async function getDriveFileIdByName(uniqueFileName: string): Promise<{ success: boolean; fileId?: string; message?: string }> {
    try {
        const auth = await getAuth();
        const drive = google.drive({ version: 'v3', auth });

        const res = await drive.files.list({
            q: `name='${uniqueFileName}' and '${DRIVE_FOLDER_ID}' in parents and trashed=false`,
            fields: 'files(id)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        if (res.data.files && res.data.files.length > 0) {
            const fileId = res.data.files[0].id;
            if (fileId) {
                return { success: true, fileId: fileId };
            }
        }
        
        throw new Error(`File '${uniqueFileName}' not found in Drive after upload.`);

    } catch (e: any) {
        console.error("Error getting Google Drive file ID by name:", e);
        return { success: false, message: e.message || 'Could not get Google Drive file ID.' };
    }
}


export async function createPrintJob(job: Omit<PrintJob, 'id' | 'createdAt'>): Promise<{success: boolean, id?: string, message?: string}> {
  const jobsCollection = collection(db, "print_jobs");
  try {
    // 1. Add the new job
    const docRef = await addDoc(jobsCollection, {
      ...job,
      createdAt: serverTimestamp(),
    });
    console.log("Document created with ID: ", docRef.id);

    // 2. After adding, check and prune the collection
    const q = query(jobsCollection, orderBy("createdAt", "asc"));
    const querySnapshot = await getDocs(q);
    const totalJobs = querySnapshot.size;
    
    if (totalJobs > MAX_JOBS_IN_COLLECTION) {
        const jobsToDeleteCount = totalJobs - MAX_JOBS_IN_COLLECTION;
        console.log(`Job collection size (${totalJobs}) exceeds limit. Deleting ${jobsToDeleteCount} oldest jobs.`);
        
        const batch = writeBatch(db);
        const jobsToDelete = querySnapshot.docs.slice(0, jobsToDeleteCount);

        jobsToDelete.forEach(doc => {
            console.log(`  - Marking for deletion: ${doc.id}`);
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`✅ Successfully deleted ${jobsToDeleteCount} oldest jobs.`);
    }

    return { success: true, id: docRef.id };
  } catch (e: any) {
    console.error("Error adding document or pruning collection: ", e);
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
      // If the document exists but is empty, or uses the old structure, reset to default.
      if (!data || Object.keys(data).length === 0) {
        await setDoc(docRef, defaultPricing);
        return defaultPricing;
      }
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


export async function getPaperSizes(): Promise<PaperSizes> {
    const docRef = doc(db, "settings", "paperSizes");
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { ...defaultPaperSizes, ...docSnap.data() } as PaperSizes;
        } else {
            await setDoc(docRef, defaultPaperSizes);
            return defaultPaperSizes;
        }
    } catch (e) {
        console.error("Error fetching paper sizes: ", e);
        return defaultPaperSizes;
    }
}

export async function updatePaperSizes(newSizes: PaperSizes): Promise<{ success: boolean; message?: string }> {
    try {
        const docRef = doc(db, "settings", "paperSizes");
        await setDoc(docRef, newSizes, { merge: true });
        return { success: true };
    } catch (e: any) {
        console.error("Error updating paper sizes: ", e);
        return { success: false, message: e.message || "Could not update paper size settings." };
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

export async function deleteAllPrintJobs(): Promise<{ success: boolean, count?: number, message?: string }> {
    try {
        const jobsCollection = collection(db, "print_jobs");
        const querySnapshot = await getDocs(jobsCollection);
        const count = querySnapshot.size;

        if (count === 0) {
            return { success: true, count: 0, message: "No jobs to delete." };
        }

        // Firestore allows a maximum of 500 operations in a single batch.
        const batchArray = [];
        let currentBatch = writeBatch(db);
        let operations = 0;

        querySnapshot.forEach(doc => {
            currentBatch.delete(doc.ref);
            operations++;
            if (operations === 500) {
                batchArray.push(currentBatch);
                currentBatch = writeBatch(db);
                operations = 0;
            }
        });

        if (operations > 0) {
            batchArray.push(currentBatch);
        }

        await Promise.all(batchArray.map(batch => batch.commit()));

        return { success: true, count };

    } catch (error: any) {
        console.error("Error deleting all print jobs: ", error);
        return { success: false, message: error.message || "Failed to delete all print jobs." };
    }
}

export async function reprintJob(jobId: string, newPrinterId: string, newPrinterName: string): Promise<{ success: boolean; message?: string }> {
    if (!jobId || !newPrinterId || !newPrinterName) {
        return { success: false, message: 'Missing job ID or new printer information.' };
    }
    try {
        const jobRef = doc(db, "print_jobs", jobId);
        await updateDoc(jobRef, {
            status: 'ready',
            printerId: newPrinterId,
            name: newPrinterName,
            isReprint: true,
            error_message: null, // Clear previous error
        });
        return { success: true };
    } catch (e: any) {
        console.error(`Error reprinting job ${jobId}: `, e);
        return { success: false, message: e.message || 'Could not send job for reprint.' };
    }
}


// --- RAZORPAY ACTIONS ---

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!
});


export async function createRazorpayOrder(amount: number, currency: string, receiptId: string): Promise<{success: boolean, order?: any, message?: string}> {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        return { success: false, message: 'Razorpay keys are not configured on the server.' };
    }

    try {
        const options = {
            amount: amount * 100, // Amount in paise
            currency,
            receipt: receiptId,
            notes: {
                'project': 'PrintEase'
            }
        };

        const order = await razorpay.orders.create(options);
        
        return { success: true, order: order };

    } catch (e: any) {
        console.error("Error creating Razorpay order:", e);
        return { success: false, message: e.message || 'Could not create Razorpay order.' };
    }
}


export async function verifyRazorpayPayment(razorpay_order_id: string, razorpay_payment_id: string, razorpay_signature: string): Promise<{success: boolean, message?: string}> {
    if (!process.env.RAZORPAY_KEY_SECRET) {
        return { success: false, message: 'Razorpay secret key is not configured.' };
    }
    try {
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                                    .update(body.toString())
                                    .digest('hex');
        
        if (expectedSignature === razorpay_signature) {
            return { success: true, message: "Payment verified successfully." };
        } else {
            return { success: false, message: "Payment signature verification failed." };
        }

    } catch (e: any) {
        console.error("Error verifying Razorpay payment:", e);
        return { success: false, message: e.message || 'Could not verify payment.' };
    }
}


export async function updatePrintJobsWithPayment(jobIds: string[], paymentId: string, razorpayOrderId: string): Promise<{ success: boolean; message?: string }> {
    try {
        const batch = writeBatch(db);
        for (const jobId of jobIds) {
            const jobRef = doc(db, "print_jobs", jobId);
            batch.update(jobRef, {
                status: 'ready',
                paymentId: paymentId,
                razorpayOrderId: razorpayOrderId,
                paymentMethod: 'upi',
                paymentTime: serverTimestamp()
            });
        }
        await batch.commit();
        return { success: true };
    } catch (e: any) {
        console.error("Error updating jobs with payment info: ", e);
        return { success: false, message: e.message || 'Could not update jobs in database.' };
    }
}

// Dummy logout function to prevent errors from components that may still call it.
export async function logout(): Promise<{ success: boolean }> {
    return { success: true };
}

export async function login(password: string): Promise<{ success: boolean, message?: string }> {
    if (password === 'ridha123') {
        // In a real app, you'd set a secure, http-only cookie here.
        // For this simplified example, we'll assume success means the client can proceed.
        return { success: true };
    } else {
        return { success: false, message: 'Invalid password.' };
    }
}
