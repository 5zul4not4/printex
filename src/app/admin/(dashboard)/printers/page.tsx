
'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase/config';
import { collection, query, onSnapshot, where, getDoc, doc } from 'firebase/firestore';
import { createTestPrintJob, updatePrinterCapabilities } from '@/lib/firebase/actions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatRelative } from 'date-fns';
import { Printer, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { PrintJob, Printer as PrinterType } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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

const paperSizes: ('A4' | 'A3' | 'A2' | 'A1' | 'A0')[] = ['A4', 'A3', 'A2', 'A1', 'A0'];
const printerColors = ["bg-blue-50", "bg-green-50", "bg-yellow-50", "bg-purple-50", "bg-pink-50"];

export default function PrintersPage() {
  const [printers, setPrinters] = useState<PrinterType[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTestingPrinter, setIsTestingPrinter] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    setIsLoading(true);

    const printersQuery = query(collection(db, "printers"));
    const unsubscribePrinters = onSnapshot(printersQuery, async (querySnapshot) => {
        const printersDataPromises = querySnapshot.docs.map(async (doc) => {
            const data = doc.data();
            const convertedData = convertTimestamps(data);
            
            let printerName = convertedData.name;
            if (!printerName && data.printerId) {
                const printerDoc = await getDoc(doc(db, 'printers', data.printerId));
                if(printerDoc.exists()){
                    printerName = printerDoc.data().name;
                }
            }

            return {
                id: doc.id,
                ...convertedData,
                name: printerName || doc.id.replace(/_/g, ' '),
                queueLength: 0, 
            } as PrinterType;
        });

        const printersData = await Promise.all(printersDataPromises);
         setPrinters(printersData);
         setIsLoading(false);
    }, (error) => {
        console.error("Error fetching printers in real-time:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not load printers." });
        setPrinters([]);
        setIsLoading(false);
    });

    const jobsQueueQuery = query(collection(db, "print_jobs"), where('status', 'in', ['ready', 'printing']));
    const unsubscribeQueues = onSnapshot(jobsQueueQuery, (snapshot) => {
        setPrinters(prevPrinters => {
            if (!prevPrinters) return null;
            const queueCounts = new Map<string, number>();
            snapshot.docs.forEach(doc => {
                const job = doc.data() as PrintJob;
                if(job.printerId) {
                    queueCounts.set(job.printerId, (queueCounts.get(job.printerId) || 0) + 1);
                }
            });

            return prevPrinters.map(p => ({
                ...p,
                queueLength: queueCounts.get(p.id) || 0
            }));
        });
    });

    return () => {
        unsubscribePrinters();
        unsubscribeQueues();
    };
  }, [toast]);

  const handleTestPrint = async (printer: PrinterType) => {
    setIsTestingPrinter(printer.id);
    const result = await createTestPrintJob(printer.id, printer.name);
    if (result.success) {
      toast({
        title: "Test Print Sent",
        description: `A test page has been sent to printer ${printer.name}.`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error",
        description: result.message || "Failed to send test print.",
      });
    }
    setIsTestingPrinter(null);
  };
  
  const handleCapabilityChange = async (printerId: string, capability: string, checked: boolean) => {
    const printer = printers?.find(p => p.id === printerId);
    if (!printer) return;

    let newCapabilities = [...(printer.capabilities || [])];
    
    if (capability === 'duplex') {
        newCapabilities = newCapabilities.filter(c => c !== 'duplex' && c !== 'single-sided');
        if (checked) {
            newCapabilities.push('duplex');
            newCapabilities.push('single-sided'); // Assume it can do both
        } else {
            // This case is tricky, for now we assume unchecking duplex means single-sided only
            newCapabilities = newCapabilities.filter(c => c !== 'duplex');
        }
    } else {
        if (checked) {
            if (!newCapabilities.includes(capability as any)) {
                newCapabilities.push(capability as any);
            }
        } else {
            newCapabilities = newCapabilities.filter(c => c !== capability);
        }
    }
    
    setPrinters(printers => printers?.map(p => p.id === printerId ? {...p, capabilities: newCapabilities as any} : p) || null);
    
    const result = await updatePrinterCapabilities(printerId, newCapabilities as any);
    if (!result.success) {
      toast({ variant: "destructive", title: "Error", description: "Could not update printer capabilities." });
      // Revert UI change on failure
      setPrinters(printers => printers?.map(p => p.id === printerId ? printer : p) || null);
    }
  };

  const getPrinterStatusVariant = (status: string) => {
    if (status === 'online') return 'default';
    return 'secondary';
  };
  
  return (
    <div className="space-y-6">
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Printers</CardTitle>
                </div>
                <CardDescription>Printers connected to the system via the local connector, updated in real-time.</CardDescription>
            </CardHeader>
        </Card>
        {isLoading ? (
            <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
        ) : printers && printers.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {printers.map((printer, index) => (
                <Card key={printer.id} className={cn("flex flex-col", printerColors[index % printerColors.length])}>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                            <span>{printer.name}</span>
                            <Badge variant={getPrinterStatusVariant(printer.status)} className="capitalize">{printer.status}</Badge>
                        </CardTitle>
                        <CardDescription>
                            Queue: {printer.queueLength || 0} | Last seen: {printer.lastSeen ? formatRelative(new Date(printer.lastSeen), new Date()) : 'Never'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow space-y-6">
                         <div>
                            <h4 className="font-medium mb-3">Capabilities</h4>
                            <div className="space-y-4 rounded-lg bg-background/50 p-4 border">
                                <div>
                                    <Label className="font-semibold">Print Type</Label>
                                    <div className="flex items-center gap-6 mt-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox 
                                                id={`bw-${printer.id}`}
                                                checked={printer.capabilities?.includes('bw')}
                                                onCheckedChange={(checked) => handleCapabilityChange(printer.id, 'bw', checked as boolean)}
                                            />
                                            <Label htmlFor={`bw-${printer.id}`}>B/W</Label>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Checkbox 
                                                id={`color-${printer.id}`}
                                                checked={printer.capabilities?.includes('color')}
                                                onCheckedChange={(checked) => handleCapabilityChange(printer.id, 'color', checked as boolean)}
                                            />
                                            <Label htmlFor={`color-${printer.id}`}>Color</Label>
                                        </div>
                                    </div>
                                </div>
                                <Separator />
                                <div>
                                    <Label className="font-semibold">Sides</Label>
                                    <div className="flex items-center gap-6 mt-2">
                                         <div className="flex items-center gap-2">
                                            <Checkbox 
                                                id={`duplex-${printer.id}`}
                                                checked={printer.capabilities?.includes('duplex')}
                                                onCheckedChange={(checked) => handleCapabilityChange(printer.id, 'duplex', checked as boolean)}
                                            />
                                            <Label htmlFor={`duplex-${printer.id}`}>Duplex</Label>
                                        </div>
                                    </div>
                                </div>
                                 <Separator />
                                <div>
                                    <Label className="font-semibold">Paper Sizes</Label>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 mt-2">
                                        {paperSizes.map(size => (
                                            <div key={size} className="flex items-center gap-2">
                                                <Checkbox 
                                                    id={`${size}-${printer.id}`}
                                                    checked={printer.capabilities?.includes(size)}
                                                    onCheckedChange={(checked) => handleCapabilityChange(printer.id, size, checked as boolean)}
                                                />
                                                <Label htmlFor={`${size}-${printer.id}`}>{size}</Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                         </div>
                    </CardContent>
                    <CardFooter>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleTestPrint(printer)}
                            disabled={isTestingPrinter === printer.id || printer.status !== 'online'}
                            className="bg-white"
                        >
                            {isTestingPrinter === printer.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Test Print
                        </Button>
                    </CardFooter>
                </Card>
            ))}
            </div>
        ) : (
            <div className="text-center py-16 text-muted-foreground bg-card rounded-lg border">
                <p className="font-semibold">No printers connected.</p>
                <p className="text-sm">Ensure the local connector script is running on the print shop's PC.</p>
            </div>
        )}
    </div>
  );
}
