
// src/lib/firebase/firestore.ts
'use server';
import { collection, getDocs, query, orderBy, limit, Timestamp, where, getDoc, doc, FieldFilter } from "firebase/firestore";
import { db } from "./config";
import type { PrintJob, Printer } from "@/lib/types";

// Helper function to safely convert any Firestore Timestamps in an object to ISO strings
function convertTimestamps(data: any): any {
    if (!data) return data;
    const newData: { [key: string]: any } = {};
    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            const value = data[key];
            if (value instanceof Timestamp) {
                newData[key] = value.toDate().toISOString();
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                newData[key] = convertTimestamps(value);
            }
            else {
                newData[key] = value;
            }
        }
    }
    return newData;
}

export async function getPrintJobs(): Promise<PrintJob[]> {
  try {
    const q = query(collection(db, "print_jobs"), orderBy("createdAt", "desc"), limit(50));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => {
      const data = doc.data();
      const convertedData = convertTimestamps(data);
      return {
        id: doc.id,
        ...convertedData,
      } as PrintJob;
    });
  } catch (e) {
    console.error("Error fetching print jobs: ", e);
    return [];
  }
}

export async function getPrintJobsByStatus(status: PrintJob['status']): Promise<PrintJob[]> {
    try {
      const q = query(
        collection(db, "print_jobs"),
        where("status", "==", status),
        orderBy("createdAt", "desc"),
        limit(50)
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => {
        const data = doc.data();
        const convertedData = convertTimestamps(data);
        return {
          id: doc.id,
          ...convertedData,
        } as PrintJob;
      });
    } catch (e) {
      console.error(`Error fetching print jobs with status ${status}: `, e);
      return [];
    }
  }

export async function getPrintJobById(id: string): Promise<PrintJob | null> {
    try {
        const docRef = doc(db, "print_jobs", id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const convertedData = convertTimestamps(data);
            return {
                id: docSnap.id,
                ...convertedData,
            } as PrintJob;
        } else {
            return null;
        }
    } catch (e) {
        console.error("Error fetching print job by ID: ", e);
        return null;
    }
}

export async function getPrinters(): Promise<Printer[]> {
    try {
        const printersSnapshot = await getDocs(collection(db, "printers"));
        if (printersSnapshot.empty) {
            return [];
        }

        const printers = printersSnapshot.docs.map(doc => {
            const data = doc.data();
            const convertedData = convertTimestamps(data);
            return {
                id: doc.id,
                ...convertedData,
                queueLength: 0, // Initialize queue length
            } as Printer;
        });

        // This calculation is now done on the client for real-time updates.
        // The server-side fetch can remain simple.
        
        return printers;
    } catch (e) {
        console.error("Error fetching printers: ", e);
        return [];
    }
}
    
