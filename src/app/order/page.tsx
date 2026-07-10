
'use client';

import type { Printer } from '@/lib/types';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase/config';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { Stepper } from './stepper';

// Dynamically import the OrderForm on the client side only
const OrderForm = dynamic(() => import('./order-form').then(mod => mod.OrderForm), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading Order Form...</p>
      </div>
    </div>
  ),
});

function convertTimestamps(data: any): any {
    if (!data) return data;
    const newData: { [key: string]: any } = {};
    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            const value = data[key];
            if (value && typeof value.toDate === 'function') { // Check for Firestore Timestamp
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


export default function OrderPage() {
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [step, setStep] = useState(1);

  useEffect(() => {
    // Listen for real-time printer updates
    const printersQuery = query(
        collection(db, "printers"),
        where("status", "==", "online"),
        orderBy("estimatedWaitTime", "asc")
    );
    const unsubscribe = onSnapshot(printersQuery, (querySnapshot) => {
        const printersData = querySnapshot.docs.map(doc => {
            const data = doc.data();
            const convertedData = convertTimestamps(data);
            return { id: doc.id, ...convertedData } as Printer;
        });
        setPrinters(printersData);
    }, (error) => {
        console.error("Error fetching printers in real-time:", error);
        setPrinters([]);
    });

    return () => unsubscribe();
  }, []);

  return (
     <div className="bg-gray-50 min-h-screen">
      <header className="sticky top-0 z-20 bg-white border-b">
        <div className="container mx-auto px-0 sm:px-4 md:px-6 py-4">
          <Stepper currentStep={step} setStep={setStep} />
        </div>
      </header>
       <main className="container mx-auto px-4 md:px-6 py-8">
        <div className="max-w-3xl mx-auto">
          {printers === null ? (
             <div className="flex items-center justify-center min-h-[50vh]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-muted-foreground">Connecting to printers...</p>
                </div>
            </div>
          ) : (
             <OrderForm initialPrinters={printers} currentStep={step} setStep={setStep} />
          )}
        </div>
      </main>
    </div>
  );
}
