'use server';

import { collection, addDoc, serverTimestamp, doc, getDoc, setDoc, updateDoc, getDocs, writeBatch, query, orderBy, limit, deleteDoc } from "firebase/firestore";
import { db } from "./config";
import type { PrintJob, Printer, Pricing, PaperSizes } from "@/lib/types";
import Razorpay from 'razorpay';
import crypto from 'crypto';
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

const defaultPaperSizes: PaperSizes = {
    A0: false,
    A1: false,
    A2: false,
    A3: true,
    A4: true,
};

const MAX_JOBS_IN_COLLECTION = 1000;

export async function registerConnector(
  host: string,
  port: number,
  printerIds: string[]
): Promise<{ success: boolean; message?: string }> {
  try {
    const batch = writeBatch(db);
    for (const printerId of printerIds) {
      const ref = doc(db, 'printers', printerId);
      batch.update(ref, {
        connectorHost: host,
        connectorPort: port,
        lastSeen: serverTimestamp(),
      });
    }
    await batch.commit();
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function createPrintJob(job: Omit<PrintJob, 'id' | 'createdAt'>): Promise<{success: boolean, id?: string, message?: string}> {
  const jobsCollection = collection(db, "print_jobs");
  try {
    const docRef = await addDoc(jobsCollection, {
      ...job,
      createdAt: serverTimestamp(),
    });

    const q = query(jobsCollection, orderBy("createdAt", "asc"));
    const querySnapshot = await getDocs(q);
    const totalJobs = querySnapshot.size;

    if (totalJobs > MAX_JOBS_IN_COLLECTION) {
        const jobsToDeleteCount = totalJobs - MAX_JOBS_IN_COLLECTION;
        const batch = writeBatch(db);
        const jobsToDelete = querySnapshot.docs.slice(0, jobsToDeleteCount);
        jobsToDelete.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    return { success: true, id: docRef.id };
  } catch (e: any) {
    return { success: false, message: e.message || 'Could not create print job in database.' };
  }
}

export async function updatePrintJobStatus(jobId: string, status: PrintJob['status'], errorMessage?: string): Promise<{ success: boolean; message?: string }> {
  if (!jobId) return { success: false, message: 'Job ID is missing.' };
  try {
    const jobRef = doc(db, "print_jobs", jobId);
    const updateData: any = { status };
    if (errorMessage) updateData.error_message = errorMessage;
    await updateDoc(jobRef, updateData);
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message || 'Could not update job status.' };
  }
}

export async function createTestPrintJob(printerId: string, printerName: string): Promise<{success: boolean, message?: string}> {
    if (!printerId) return { success: false, message: 'Printer ID is missing.' };
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
                streamSessionId: 'none',
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
        return { success: true, message: `Test page sent to printer ${printerName}` };
    } catch (e: any) {
        return { success: false, message: 'Could not create test print job.' };
    }
}

export async function createStreamSession(fileName: string, fileSize: number): Promise<{success: boolean; sessionId?: string; message?: string}> {
  try {
    const sessionId = uuidv4();
    await setDoc(doc(db, 'stream_sessions', sessionId), {
      status: 'pending',
      progress: 0,
      fileName,
      fileSize,
      method: null,
      browserSdp: null,
      connectorSdp: null,
      errorMessage: null,
      createdAt: serverTimestamp(),
    });
    return { success: true, sessionId };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getStreamSessionStatus(sessionId: string): Promise<{success: boolean; status?: string; progress?: number; message?: string}> {
  try {
    const snap = await getDoc(doc(db, 'stream_sessions', sessionId));
    if (!snap.exists()) return { success: false, message: 'Session not found' };
    const data = snap.data();
    return { success: true, status: data.status, progress: data.progress };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function deleteStreamSession(sessionId: string): Promise<void> {
  try { await deleteDoc(doc(db, 'stream_sessions', sessionId)); } catch {}
}

export async function getPricing(): Promise<Pricing> {
  const docRef = doc(db, "settings", "pricing");
  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (!data || Object.keys(data).length === 0) {
        await setDoc(docRef, defaultPricing);
        return defaultPricing;
      }
      return { ...defaultPricing, ...data } as Pricing;
    } else {
      await setDoc(docRef, defaultPricing);
      return defaultPricing;
    }
  } catch (e) {
    try { await setDoc(docRef, defaultPricing); } catch {}
    return defaultPricing;
  }
}

export async function updatePricing(newPricing: Pricing): Promise<{ success: boolean; message?: string }> {
  try {
    const docRef = doc(db, "settings", "pricing");
    await setDoc(docRef, newPricing);
    return { success: true };
  } catch (e: any) {
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
        return defaultPaperSizes;
    }
}

export async function updatePaperSizes(newSizes: PaperSizes): Promise<{ success: boolean; message?: string }> {
    try {
        const docRef = doc(db, "settings", "paperSizes");
        await setDoc(docRef, newSizes, { merge: true });
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || "Could not update paper size settings." };
    }
}

export async function updatePrinterCapabilities(printerId: string, capabilities: Printer['capabilities']): Promise<{ success: boolean; message?: string }> {
    try {
        const printerRef = doc(db, "printers", printerId);
        await updateDoc(printerRef, { capabilities });
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Could not update printer capabilities.' };
    }
}

export async function requestPageCount(streamSessionId: string, originalFileName: string): Promise<{success: boolean; jobId?: string; message?: string}> {
    try {
        const jobData: Partial<PrintJob> = {
            orderType: 'page-count-request',
            status: 'page-count-request',
            files: [],
            cost: 0,
            username: 'page-count-service',
            orderId: 'page-count-service',
            fileName: originalFileName,
            streamSessionId: streamSessionId as any,
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
        if (count === 0) return { success: true, count: 0, message: "No jobs to delete." };

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

        if (operations > 0) batchArray.push(currentBatch);
        await Promise.all(batchArray.map(batch => batch.commit()));
        return { success: true, count };
    } catch (error: any) {
        return { success: false, message: error.message || "Failed to delete all print jobs." };
    }
}

export async function reprintJob(jobId: string, newPrinterId: string, newPrinterName: string): Promise<{ success: boolean; message?: string }> {
    if (!jobId || !newPrinterId || !newPrinterName) return { success: false, message: 'Missing job ID or new printer information.' };
    try {
        const jobRef = doc(db, "print_jobs", jobId);
        await updateDoc(jobRef, {
            status: 'ready',
            printerId: newPrinterId,
            name: newPrinterName,
            isReprint: true,
            error_message: null,
        });
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Could not send job for reprint.' };
    }
}

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!
});

export async function createRazorpayOrder(amount: number, currency: string, receiptId: string): Promise<{success: boolean, order?: any, message?: string}> {
    try {
        const options = { amount: amount * 100, currency, receipt: receiptId, notes: { project: 'PrintEx' } };
        const order = await razorpay.orders.create(options);
        return { success: true, order };
    } catch (e: any) {
        return { success: false, message: e.message || 'Could not create Razorpay order.' };
    }
}

export async function verifyRazorpayPayment(razorpay_order_id: string, razorpay_payment_id: string, razorpay_signature: string): Promise<{success: boolean, message?: string}> {
    try {
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
                                    .update(body.toString())
                                    .digest('hex');
        if (expectedSignature === razorpay_signature) {
            return { success: true, message: "Payment verified successfully." };
        } else {
            return { success: false, message: "Payment signature verification failed." };
        }
    } catch (e: any) {
        return { success: false, message: e.message || 'Could not verify payment.' };
    }
}

export async function updatePrintJobsWithPayment(jobIds: string[], paymentId: string, razorpayOrderId: string, status: PrintJob['status'] = 'ready'): Promise<{ success: boolean; message?: string }> {
    try {
        const batch = writeBatch(db);
        for (const jobId of jobIds) {
            const jobRef = doc(db, "print_jobs", jobId);
            const updateData: any = { status, paymentId, razorpayOrderId };
            if (status === 'ready') {
                updateData.paymentMethod = 'upi';
                updateData.paymentTime = serverTimestamp();
            }
            batch.update(jobRef, updateData);
        }
        await batch.commit();
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message || 'Could not update jobs in database.' };
    }
}

export async function logout(): Promise<{ success: boolean }> {
    return { success: true };
}

export async function login(password: string): Promise<{ success: boolean, message?: string }> {
    if (password === 'ridha123') {
        return { success: true };
    } else {
        return { success: false, message: 'Invalid password.' };
    }
}
