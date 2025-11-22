'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase/config';
import { collection, query, orderBy, limit, onSnapshot, where } from 'firebase/firestore';
import { deleteAllPrintJobs, reprintJob } from '@/lib/firebase/actions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { FileText, Loader2, AlertCircle, Trash2, Printer as PrinterIcon, Phone, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { PrintJob, Printer } from '@/lib/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

// Helper to group jobs by a common orderId
type GroupedOrder = {
    orderId: string;
    phoneNumber: string;
    createdAt: string;
    totalCost: number;
    statuses: string[];
    jobs: PrintJob[];
};


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

const ReprintDialog = ({ job, printers }: { job: PrintJob, printers: Printer[] }) => {
    const [selectedPrinterId, setSelectedPrinterId] = useState<string | null>(null);
    const [isReprinting, setIsReprinting] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const { toast } = useToast();

    const getCompatiblePrinters = () => {
        if (!printers) return [];
        return printers.filter(p => {
            return p.status === 'online' && job.files.every(f => {
                const caps = p.capabilities || [];
                const duplexCompatible = f.duplex === 'one-sided' || (caps.includes('duplex'));
                return caps.includes(f.printType) && caps.includes(f.paperSize) && duplexCompatible;
            });
        });
    };

    const compatiblePrinters = getCompatiblePrinters();

    const handleReprint = async () => {
        if (!selectedPrinterId) {
            toast({ variant: 'destructive', title: 'Error', description: 'Please select a printer.' });
            return;
        }
        setIsReprinting(true);
        const selectedPrinter = printers.find(p => p.id === selectedPrinterId);
        if (!selectedPrinter) {
            toast({ variant: 'destructive', title: 'Error', description: 'Selected printer not found.' });
            setIsReprinting(false);
            return;
        }

        const result = await reprintJob(job.id, selectedPrinter.id, selectedPrinter.name);
        if (result.success) {
            toast({ title: 'Success', description: `Job ${job.id.substring(0, 8)} sent for reprint.` });
            setIsOpen(false);
        } else {
            toast({ variant: 'destructive', title: 'Reprint Failed', description: result.message });
        }
        setIsReprinting(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reprint
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reprint Job</DialogTitle>
                    <DialogDescription>
                        Select a new printer for job <span className="font-mono">{job.id.substring(0,8)}</span>.
                        The cost will not be re-calculated.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-2">
                    <label className="text-sm font-medium">Compatible Printers</label>
                    {compatiblePrinters.length > 0 ? (
                        <Select onValueChange={setSelectedPrinterId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a printer..." />
                            </SelectTrigger>
                            <SelectContent>
                                {compatiblePrinters.map(p => (
                                    <SelectItem key={p.id} value={p.id}>
                                        <div className="flex justify-between items-center">
                                            <span>{p.name}</span>
                                            <Badge variant="outline" className="ml-4">Queue: {p.queueLength}</Badge>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <p className="text-sm text-muted-foreground p-4 border rounded-md bg-muted">No compatible online printers found.</p>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="ghost">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleReprint} disabled={isReprinting || !selectedPrinterId}>
                        {isReprinting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Send to Printer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


export default function AdminDashboard() {
  const [groupedOrders, setGroupedOrders] = useState<GroupedOrder[] | null>(null);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [jobCount, setJobCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeletingJobs, setIsDeletingJobs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    setIsLoading(true);
    
    // Listen to all non-test print jobs
    const jobsQuery = query(
        collection(db, "print_jobs"),
        where("orderType", "==", "print"), 
        orderBy("createdAt", "desc"),
        limit(100) // Fetch more jobs to group them
    );
    const unsubscribeJobs = onSnapshot(jobsQuery, (querySnapshot) => {
        const jobsData = querySnapshot.docs.map(doc => {
            const data = doc.data();
            const convertedData = convertTimestamps(data);
            return { id: doc.id, ...convertedData } as PrintJob;
        });

        // Group jobs by orderId
        const ordersMap = new Map<string, GroupedOrder>();
        jobsData.forEach(job => {
            if (!job.orderId) return; // Skip jobs without an orderId

            let order = ordersMap.get(job.orderId);
            if (!order) {
                order = {
                    orderId: job.orderId,
                    phoneNumber: job.phoneNumber || 'N/A',
                    createdAt: job.createdAt,
                    totalCost: 0,
                    statuses: [],
                    jobs: [],
                };
            }
            order.jobs.push(job);
            order.totalCost += job.cost;
            if (!order.statuses.includes(job.status)) {
                order.statuses.push(job.status);
            }
            // Use the latest createdAt time for sorting
            if (new Date(job.createdAt) > new Date(order.createdAt)) {
                order.createdAt = job.createdAt;
            }
            ordersMap.set(job.orderId, order);
        });
        
        const sortedOrders = Array.from(ordersMap.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        setGroupedOrders(sortedOrders);
        setJobCount(jobsData.length);
        setIsLoading(false);
    }, (error) => {
        console.error("Error fetching print jobs in real-time:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not load print jobs." });
        setGroupedOrders([]);
        setIsLoading(false);
    });

    const printersQuery = query(collection(db, "printers"));
    const unsubscribePrinters = onSnapshot(printersQuery, (querySnapshot) => {
        const printersData = querySnapshot.docs.map(doc => {
            const data = doc.data();
            const convertedData = convertTimestamps(data);
            return { id: doc.id, ...convertedData } as Printer;
        });
        setPrinters(printersData);
    });

    return () => {
        unsubscribeJobs();
        unsubscribePrinters();
    };
  }, [toast]);

  const handleDeleteAllJobs = async () => {
    setIsDeletingJobs(true);
    const result = await deleteAllPrintJobs();
    if (result.success) {
        toast({
            title: "Success",
            description: `${result.count} print jobs have been deleted.`,
        });
    } else {
        toast({
            variant: "destructive",
            title: "Error",
            description: result.message || "Could not delete print jobs.",
        });
    }
    setIsDeletingJobs(false);
  }

  const getCombinedStatusBadge = (statuses: string[]) => {
    if (statuses.includes('error')) return { variant: 'destructive', label: 'Error' };
    if (statuses.includes('reprint-completed')) return { variant: 'default', label: 'Reprint Done' };
    if (statuses.includes('printing')) return { variant: 'secondary', label: 'Printing' };
    if (statuses.includes('ready')) return { variant: 'outline', label: 'Ready' };
    if (statuses.every(s => s === 'completed')) return { variant: 'default', label: 'Completed' };
    return { variant: 'secondary', label: 'Processing' };
  };

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case 'completed': return 'default';
      case 'reprint-completed': return 'default';
      case 'printing': return 'secondary';
      case 'ready': case 'pending': return 'outline';
      case 'error': return 'destructive';
      default: return 'secondary';
    }
  };
  
  const filteredOrders = groupedOrders?.filter(order => 
    order.phoneNumber.includes(searchQuery)
  );

  return (
    <TooltipProvider>
      <div className="space-y-6">
          <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <FileText className="w-5 h-5 text-muted-foreground" />
                            <CardTitle>Recent Print Orders</CardTitle>
                        </div>
                        <CardDescription>A real-time list of recent orders, grouped by customer.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder="Search by phone..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8 sm:w-[200px] md:w-[250px]"
                            />
                        </div>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" disabled={isDeletingJobs || jobCount === 0}>
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete All
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This action cannot be undone. This will permanently delete all
                                        print jobs from the database.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDeleteAllJobs} disabled={isDeletingJobs}>
                                        {isDeletingJobs ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null}
                                        Delete
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                  <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
              ) : filteredOrders && filteredOrders.length > 0 ? (
                <div className="space-y-4">
                    {filteredOrders.map((order) => {
                        const combinedStatus = getCombinedStatusBadge(order.statuses);
                        const allFilesInOrder = order.jobs.flatMap(j => j.files);

                        return (
                            <Card key={order.orderId} className="p-4">
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                                    <div className='flex-1'>
                                        <div className="flex items-center gap-2 mb-1">
                                            <Phone className="w-4 h-4 text-muted-foreground"/>
                                            <p className="font-bold text-lg">{order.phoneNumber}</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Order ID: <span className="font-mono">{order.orderId}</span>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 text-sm">
                                        <div className='text-right'>
                                            <p className="font-semibold text-lg">₹{order.totalCost.toFixed(2)}</p>
                                            <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(order.createdAt), { addSuffix: true })}</p>
                                        </div>
                                        <Badge variant={combinedStatus.variant} className="capitalize h-fit">{combinedStatus.label}</Badge>
                                    </div>
                                </div>
                                <Separator className="my-3"/>
                                <div className="space-y-3">
                                    <p className="text-sm font-medium">Jobs ({order.jobs.length})</p>
                                    {order.jobs.map(job => (
                                       <div key={job.id} className="pl-4 border-l-2">
                                          <div className="flex items-start justify-between text-sm mb-2 gap-4">
                                              <div className="flex items-center gap-2 flex-1">
                                                  <PrinterIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                                  <span className="font-semibold">{job.name}</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <Badge variant={getStatusVariant(job.status)} className="capitalize">{job.status === 'reprint-completed' ? 'Reprint Done' : job.status}</Badge>
                                                <ReprintDialog job={job} printers={printers} />
                                              </div>
                                          </div>
                                          <ol className="list-decimal list-inside text-sm space-y-1 pl-2">
                                            {job.files.map((file, idx) => (
                                                <li key={idx} className="text-muted-foreground">
                                                    <span className="text-foreground">{file.originalFileName}</span> ({file.copies}x {file.printType}, {file.paperSize})
                                                </li>
                                            ))}
                                          </ol>
                                          {job.status === 'error' && job.error_message && (
                                              <Tooltip>
                                                  <TooltipTrigger className="mt-2 flex items-center gap-1 text-xs text-destructive">
                                                      <AlertCircle className="w-3 h-3" />
                                                      Show Error
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                      <p>{job.error_message}</p>
                                                  </TooltipContent>
                                              </Tooltip>
                                          )}
                                       </div>
                                    ))}
                                </div>
                            </Card>
                        )
                    })}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                    {groupedOrders && groupedOrders.length > 0 ? 'No orders match your search.' : 'No print orders found.'}
                </div>
              )}
            </CardContent>
          </Card>
      </div>
    </TooltipProvider>
  );
}
