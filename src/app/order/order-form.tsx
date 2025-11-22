
'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, Check, CheckCircle, FileUp, FlipHorizontal, FlipVertical, Image as ImageIcon, Loader2, Minus, Palette, Phone, Plus, Printer as PrinterIcon, RefreshCw, Trash2, User, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { PrintJob, Printer, Pricing, FileInJob, ImageLayout } from '@/lib/types';
import { createPrintJob, getGoogleDriveUploadUrl, getPageCountForWordFile, createRazorpayOrder, verifyRazorpayPayment, updatePrintJobsWithPayment, getDriveFileIdByName } from '@/lib/firebase/actions';
import { getPricing } from '@/lib/firebase/actions';
import { parsePageRanges } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/firebase/config';
import { collection, onSnapshot, query, where, doc } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface FileDetails {
    id: string;
    originalFile: File;
    previewUrl?: string; // For image previews or data URIs
    uniqueFileName: string | null;
    googleDriveFileId: string | null;
    jobId?: string; // Firestore job ID for page count requests
    pageCount: number | null;
    isWordFile: boolean;
    isImageFile: boolean;
    printType: 'bw' | 'color';
    copies: number;
    pageRange: string;
    duplex: FileInJob['duplex'];
    paperSize: FileInJob['paperSize'];
    imageLayout: ImageLayout;
    orientation: FileInJob['orientation'];
    cost: number;
    status: 'pending' | 'uploading' | 'getting_id' | 'counting_pages' | 'ready_for_config' | 'processing' | 'complete' | 'error';
    progress: number;
    message?: string;
}

const paperSizes: FileInJob['paperSize'][] = ['A4', 'A3', 'A2', 'A1', 'A0'];
const isLargeFormat = (paperSize?: FileInJob['paperSize']) => paperSize === 'A2' || paperSize === 'A1' || paperSize === 'A0';

const layoutOptions: { value: ImageLayout['type']; label: string; photosPerPage: number, grid: [number, number] }[] = [
  { value: 'full-page', label: 'Full Page (1)', photosPerPage: 1, grid: [1, 1] },
  { value: '2-up', label: '10 x 15 cm (2)', photosPerPage: 2, grid: [1, 2] },
  { value: '4-up', label: '9 x 13 cm (4)', photosPerPage: 4, grid: [2, 2] },
  { value: '9-up', label: 'Wallet (9)', photosPerPage: 9, grid: [3, 3] },
  { value: 'contact-sheet', label: 'Contact Sheet (35)', photosPerPage: 35, grid: [5, 7] },
];


interface OrderFormProps {
    initialPrinters: Printer[];
    currentStep: number;
    setStep: (step: number) => void;
}

// Helper to manage round-robin counters.
const printerCategoryRotation = new Map<string, number>();
function getNextPrinterIndex(category: string, totalPrinters: number): number {
    if (totalPrinters === 0) return 0;
    const currentIndex = printerCategoryRotation.get(category) || 0;
    const nextIndex = (currentIndex + 1) % totalPrinters;
    printerCategoryRotation.set(category, nextIndex);
    return currentIndex;
}
function getFileCategory(file: FileInJob | FileDetails): string {
    return `${file.printType}-${file.paperSize}`;
}


export function OrderForm({ initialPrinters, currentStep, setStep }: OrderFormProps) {
  const { toast } = useToast();
  const [isRazorpayReady, setIsRazorpayReady] = useState(false);

  const [files, setFiles] = useState<FileDetails[]>([]);
  const [binding, setBinding] = useState<'none' | 'spiral' | 'soft'>('none');
  const [bindingFileNumbers, setBindingFileNumbers] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSuccessfulJobs, setLastSuccessfulJobs] = useState<PrintJob[] | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [printers, setPrinters] = useState<Printer[]>(initialPrinters);
  const [phoneNumber, setPhoneNumber] = useState('');

  // Use refs to store rotation indices to persist them across re-renders without causing re-renders themselves
  const rotationIndices = useRef(new Map<string, number>());
  
  const getNextIndex = (category: string, count: number) => {
    if (count === 0) return 0;
    const currentIndex = rotationIndices.current.get(category) || 0;
    const nextIndex = (currentIndex + 1) % count;
    rotationIndices.current.set(category, nextIndex);
    return currentIndex;
  };
  
  const advanceIndex = (category: string, count: number) => {
    if (count === 0) return;
    const currentIndex = rotationIndices.current.get(category) || 0;
    const nextIndex = (currentIndex + 1) % count;
    rotationIndices.current.set(category, nextIndex);
  };


  useEffect(() => {
    setPrinters(initialPrinters);
  }, [initialPrinters]);

  useEffect(() => {
    async function loadPricing() {
      const pricingData = await getPricing();
      setPricing(pricingData);
    }
    loadPricing();
  }, []);
  
  const updateFileDetails = (id: string, newDetails: Partial<Omit<FileDetails, 'id' | 'originalFile'>>) => {
    setFiles(currentFiles =>
      currentFiles.map(f => {
        if (f.id === id) {
          const updatedFile = { ...f, ...newDetails };

          // If the layout type changes, update photosPerPage
          if (newDetails.imageLayout?.type) {
            const layoutOption = layoutOptions.find(opt => opt.value === newDetails.imageLayout?.type);
            if (layoutOption) {
              updatedFile.imageLayout.photosPerPage = layoutOption.photosPerPage;
            }
          }
          return updatedFile;
        }
        return f;
      })
    );
  };
  
  useEffect(() => {
    if (!pricing) return;

    const newFiles = files.map(file => {
      let currentFile = {...file};
      if (currentFile.status !== 'ready_for_config' && currentFile.status !== 'complete') return currentFile;

      let fileCost = 0;
      
      if (currentFile.isImageFile) {
        const layout = layoutOptions.find(l => l.value === currentFile.imageLayout.type);
        const photosPerPage = layout?.photosPerPage || 1;

        let sheetCost = 0;
        if (isLargeFormat(currentFile.paperSize)) {
            const size = currentFile.paperSize;
            if (size === 'A2') sheetCost = currentFile.printType === 'bw' ? pricing.bwA2Price : pricing.colorA2Price;
            else if (size === 'A1') sheetCost = currentFile.printType === 'bw' ? pricing.bwA1Price : pricing.colorA1Price;
            else if (size === 'A0') sheetCost = currentFile.printType === 'bw' ? pricing.bwA0Price : pricing.colorA0Price;
        } else if (currentFile.paperSize === 'A3') {
            sheetCost = currentFile.printType === 'bw' ? pricing.bwA3Price : pricing.colorA3Price;
        } else { // A4
            sheetCost = currentFile.printType === 'bw' ? pricing.bwA4After10Price : pricing.colorA4Price; // Use after 10 price as a base for simplicity in collage
        }
        
        if (currentFile.imageLayout.type === 'full-page') {
            fileCost = sheetCost * currentFile.copies;
        } else {
            const sheetsNeeded = Math.ceil(currentFile.copies / photosPerPage);
            fileCost = sheetCost * sheetsNeeded;
        }

      } else { // Document file
        let pagesToPrint = parsePageRanges(currentFile.pageRange, currentFile.pageCount ?? 0).length || (currentFile.pageCount ?? 0);
        if (pagesToPrint === 0 && currentFile.pageCount && currentFile.pageCount > 0) pagesToPrint = currentFile.pageCount;
        
        if (pagesToPrint > 0) {
            let singleCopyCost = 0;
            if (isLargeFormat(currentFile.paperSize)) {
                const size = currentFile.paperSize;
                if (size === 'A2') singleCopyCost = currentFile.printType === 'bw' ? pricing.bwA2Price : pricing.colorA2Price;
                else if (size === 'A1') singleCopyCost = currentFile.printType === 'bw' ? pricing.bwA1Price : pricing.colorA1Price;
                else if (size === 'A0') singleCopyCost = currentFile.printType === 'bw' ? pricing.bwA0Price : pricing.colorA0Price;
                singleCopyCost *= pagesToPrint;
            } else if (currentFile.paperSize === 'A3') {
                singleCopyCost = (currentFile.printType === 'bw' ? pricing.bwA3Price : pricing.colorA3Price) * pagesToPrint;
            } else { // A4
                if (currentFile.printType === 'color') {
                    singleCopyCost = pagesToPrint * pricing.colorA4Price;
                } else {
                    const tier1Pages = Math.min(pagesToPrint, pricing.bwA4First10Pages);
                    const tier2Pages = Math.max(0, pagesToPrint - pricing.bwA4First10Pages);
                    singleCopyCost = (tier1Pages * pricing.bwA4First10Price) + (tier2Pages * pricing.bwA4After10Price);
                }
            }
            fileCost = singleCopyCost * currentFile.copies;
        }
      }

      currentFile.cost = fileCost;
      return currentFile;
    });

    if (JSON.stringify(newFiles) !== JSON.stringify(files)) {
        setFiles(newFiles);
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(files.map(f => `${f.id}-${f.status}-${f.pageRange}-${f.copies}-${f.printType}-${f.duplex}-${f.paperSize}-${f.imageLayout.type}`)), pricing]);

  const handleWordPageCount = async (fileId: string, googleDriveFileId: string, uniqueFileName: string) => {
    let unsubscribe: (() => void) | null = null;
    try {
        updateFileDetails(fileId, { status: 'counting_pages', message: 'Requesting page count...' });
        const result = await getPageCountForWordFile(googleDriveFileId, uniqueFileName);
        if (!result.success || !result.jobId) throw new Error(result.message || 'Could not create page count job.');

        const jobId = result.jobId;
        updateFileDetails(fileId, { jobId: jobId, message: 'Waiting for local connector...' });

        await new Promise<void>((resolve, reject) => {
            const docRef = doc(db, 'print_jobs', jobId);
            const timeout = setTimeout(() => {
                unsubscribe?.();
                reject(new Error("Timeout: Page count took too long."));
            }, 120000); // 2 min timeout

            unsubscribe = onSnapshot(docRef, (docSnap) => {
                const data = docSnap.data() as PrintJob;
                if (data) {
                    if (data.status === 'page-count-completed' && data.pageCount !== undefined) {
                        clearTimeout(timeout);
                        unsubscribe?.();
                        updateFileDetails(fileId, { pageCount: data.pageCount, status: 'ready_for_config', message: 'Ready to configure.' });
                        resolve();
                    } else if (data.status === 'error') {
                        clearTimeout(timeout);
                        unsubscribe?.();
                        const errorMessage = data.error_message || 'Connector failed to count pages.';
                        updateFileDetails(fileId, { status: 'error', message: errorMessage });
                        reject(new Error(errorMessage));
                    }
                }
            }, (error) => {
                clearTimeout(timeout);
                unsubscribe?.();
                reject(new Error(`Snapshot listener error: ${error.message}`));
            });
        });
    } catch (error: any) {
        updateFileDetails(fileId, { status: 'error', message: error.message || 'Could not get page count.' });
    } finally {
        if (unsubscribe) unsubscribe();
    }
  };

  const uploadFileAndGetPageCount = useCallback(async (fileDetail: FileDetails) => {
    const { id, originalFile, isWordFile, isImageFile } = fileDetail;
    
    updateFileDetails(id, { status: 'uploading', message: 'Requesting upload URL...' });

    try {
        const getUrlResult = await getGoogleDriveUploadUrl(originalFile.name, originalFile.type, window.location.origin);
        if (!getUrlResult.success || !getUrlResult.uniqueFileName || !getUrlResult.uploadUrl) {
            throw new Error(getUrlResult.message || 'Could not get upload URL.');
        }

        const uniqueFileName = getUrlResult.uniqueFileName;
        updateFileDetails(id, { uniqueFileName: uniqueFileName });

        const xhr = new XMLHttpRequest();
        xhr.open('PUT', getUrlResult.uploadUrl);
        xhr.setRequestHeader('Content-Type', originalFile.type);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const progress = Math.round((event.loaded / event.total) * 100);
                updateFileDetails(id, { progress, message: 'Uploading...' });
            }
        };
        
        xhr.onload = async () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                 updateFileDetails(id, { progress: 100, status: 'getting_id', message: 'Verifying upload...' });
                
                 await new Promise(resolve => setTimeout(resolve, 2000));

                 const idResult = await getDriveFileIdByName(uniqueFileName);
                 if (!idResult.success || !idResult.fileId) {
                     throw new Error(`File '${uniqueFileName}' not found in Drive after upload.`);
                 }
                 const googleDriveFileId = idResult.fileId;
                 updateFileDetails(id, { googleDriveFileId });

                if (isWordFile) {
                    await handleWordPageCount(id, googleDriveFileId, uniqueFileName);
                } else {
                    updateFileDetails(id, { status: 'ready_for_config', message: 'Ready to configure.' });
                }
            } else {
                updateFileDetails(id, { status: 'error', message: `Upload failed: ${xhr.statusText}` });
            }
        };

        xhr.onerror = () => {
             updateFileDetails(id, { status: 'error', message: 'Upload failed due to network error.' });
        };
        xhr.send(originalFile);
    } catch (error: any) {
        console.error("Error in uploadFileAndGetPageCount:", error);
        updateFileDetails(id, { status: 'error', message: error.message || 'Could not prepare upload.' });
    }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    setSubmissionError(null);
    if(lastSuccessfulJobs) setLastSuccessfulJobs(null);

    const newFileDetails: FileDetails[] = Array.from(selectedFiles).map(file => {
      const isImage = file.type.startsWith('image/');
      const isWord = file.type.includes('wordprocessingml');
      
      return {
        id: uuidv4(), originalFile: file, pageCount: null, isWordFile: isWord, isImageFile: isImage,
        uniqueFileName: null, googleDriveFileId: null, printType: isImage ? 'color' : 'bw', copies: 1, pageRange: '',
        duplex: 'one-sided', 
        paperSize: 'A4', orientation: 'portrait',
        imageLayout: { type: 'full-page', photosPerPage: 1, fit: 'contain' },
        cost: 0, progress: 0, status: 'pending'
      };
    });

    setFiles(current => [...current, ...newFileDetails]);

    newFileDetails.forEach(fileDetail => {
        const reader = new FileReader();
        reader.onload = async (event) => {
            const result = event.target?.result as string;
            updateFileDetails(fileDetail.id, { previewUrl: result });

            if (fileDetail.originalFile.type === 'application/pdf') {
                try {
                    const pdfjsLib = await import('pdfjs-dist');
                    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
                    const arrayBuffer = await fileDetail.originalFile.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                    updateFileDetails(fileDetail.id, { pageCount: pdf.numPages });
                } catch (pdfError) {
                    console.error("Error reading PDF:", pdfError);
                    updateFileDetails(fileDetail.id, { status: 'error', message: 'Could not read PDF page count.' });
                }
            } else if (fileDetail.isImageFile) {
                updateFileDetails(fileDetail.id, { pageCount: 1 });
            }
            
            uploadFileAndGetPageCount(fileDetail);
        };
        reader.onerror = () => {
            updateFileDetails(fileDetail.id, { status: 'error', message: 'Could not read file for preview.' });
        };
        reader.readAsDataURL(fileDetail.originalFile);
    });
}, [uploadFileAndGetPageCount, lastSuccessfulJobs]);
  
  const removeFile = (id: string) => {
    setFiles(files => files.filter(f => f.id !== id));
  };
  
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const filesToSubmit = files.filter(f => f.status === 'ready_for_config');
    
    if (filesToSubmit.length === 0) {
      toast({ variant: 'destructive', title: 'Missing Information', description: 'Please have at least one file ready.' });
      return;
    }

    if (!phoneNumber) {
        setSubmissionError('Phone number is required.');
        toast({ variant: 'destructive', title: 'Missing Information', description: 'Please enter your phone number.' });
        return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);
    const overallOrderId = uuidv4().substring(0, 8).toUpperCase();
    
    const onlinePrinters = printers.filter(p => p.status === 'online');
    if (onlinePrinters.length === 0) {
        setSubmissionError('No online printers available.');
        setIsSubmitting(false);
        return;
    }

    let jobsToCreate: Omit<PrintJob, 'id' | 'createdAt'>[] = [];
    const filesToBindIndices = binding === 'none' ? [] : parsePageRanges(bindingFileNumbers, filesToSubmit.length).map(i => i + 1); // 1-indexed

    // Separate bound files from unbound files
    const boundFileDetails: FileDetails[] = [];
    const unboundFileDetails: FileDetails[] = [];

    filesToSubmit.forEach((file, index) => {
        const fileNumber = index + 1;
        if (filesToBindIndices.includes(fileNumber)) {
            boundFileDetails.push(file);
        } else {
            unboundFileDetails.push(file);
        }
    });

    const fileDetailsToJobs = (details: FileDetails[]): FileInJob[] => {
      return details.map(f => ({
        fileName: f.uniqueFileName!, originalFileName: f.originalFile.name, googleDriveFileId: f.googleDriveFileId!,
        isWordFile: f.isWordFile, isImageFile: f.isImageFile, pageCount: f.pageCount!, pageRange: f.isImageFile ? 'all' : (f.pageRange.trim() || 'all'),
        copies: f.copies, printType: f.printType, paperSize: f.paperSize, imageLayout: f.isImageFile ? f.imageLayout : undefined,
        orientation: f.orientation, duplex: f.duplex,
      }));
    };

    // Create a single job for all bound files
    if (boundFileDetails.length > 0) {
        const boundFilesForJob = fileDetailsToJobs(boundFileDetails);
        const cost = boundFileDetails.reduce((acc, f) => acc + (f.cost || 0), 0);
        
        const compatiblePrinters = onlinePrinters.filter(p => boundFilesForJob.every(f => {
            const caps = p.capabilities || [];
            return caps.includes(f.printType) && caps.includes(f.paperSize) && (f.duplex === 'one-sided' || (caps.includes('duplex') || caps.includes('single-sided')));
        })).sort((a,b) => (a.queueLength || 0) - (b.queueLength || 0));

        if(compatiblePrinters.length === 0) {
            setSubmissionError('No single printer is compatible with all files selected for binding.');
            setIsSubmitting(false);
            return;
        }
        const assignedPrinter = compatiblePrinters[0];

        jobsToCreate.push({
            orderType: 'print', status: 'pending-payment', printerId: assignedPrinter.id, name: assignedPrinter.name, cost,
            username: "Customer", orderId: overallOrderId, binding: binding, files: boundFilesForJob, phoneNumber,
        });
    }

    // Group unbound files by their capability requirements
    const jobsByCategory = new Map<string, FileDetails[]>();
    unboundFileDetails.forEach(f => {
        const category = getFileCategory(f);
        const categoryFiles = jobsByCategory.get(category) || [];
        categoryFiles.push(f);
        jobsByCategory.set(category, categoryFiles);
    });

    const categoriesToAdvance = new Set<string>();

    for (const [category, filesForCategory] of jobsByCategory.entries()) {
        const filesForThisJob = fileDetailsToJobs(filesForCategory);
        
        const compatiblePrinters = onlinePrinters.filter(p => {
            const file = filesForCategory[0]; // All files in category have same requirements
            const caps = p.capabilities || [];
            const duplexCompatible = file.duplex === 'one-sided' || (caps.includes('duplex') || caps.includes('single-sided'));
            return caps.includes(file.printType) && caps.includes(file.paperSize) && duplexCompatible;
        });

        if (compatiblePrinters.length === 0) {
            filesForCategory.forEach(f => updateFileDetails(f.id, { status: 'error', message: `No compatible printer for ${f.originalFile.name}.` }));
            continue;
        }

        const printerIndex = getNextIndex(category, compatiblePrinters.length);
        const assignedPrinter = compatiblePrinters[printerIndex];
        categoriesToAdvance.add(category);

        const jobCost = filesForCategory.reduce((acc, f) => acc + (f.cost || 0), 0);
        jobsToCreate.push({
            orderType: 'print', status: 'pending-payment', printerId: assignedPrinter.id, name: assignedPrinter.name, cost: jobCost,
            username: "Customer", orderId: overallOrderId, binding: undefined, files: filesForThisJob, phoneNumber,
        });
    }

    if (jobsToCreate.length === 0 && filesToSubmit.length > 0) {
        const firstError = files.find(f => f.status === 'error')?.message;
        setSubmissionError(firstError || 'Could not assign any files to a compatible printer.');
        setIsSubmitting(false);
        return;
    }
    
    // Advance rotation indices only after a successful job creation attempt.
    categoriesToAdvance.forEach(category => {
      const compatiblePrinters = onlinePrinters.filter(p => {
            const file = jobsByCategory.get(category)?.[0];
            if (!file) return false;
            const caps = p.capabilities || [];
            const duplexCompatible = file.duplex === 'one-sided' || (caps.includes('duplex') || caps.includes('single-sided'));
            return caps.includes(file.printType) && caps.includes(file.paperSize) && duplexCompatible;
      });
      advanceIndex(category, compatiblePrinters.length);
    });


    const finalTotalCost = jobsToCreate.reduce((acc, job) => acc + job.cost, 0);

    // --- Razorpay Order Creation ---
    try {
        const razorpayOrderResult = await createRazorpayOrder(finalTotalCost, 'INR', overallOrderId);
        if (!razorpayOrderResult.success || !razorpayOrderResult.order) {
            throw new Error(razorpayOrderResult.message || 'Could not create Razorpay order.');
        }

        const { order: razorpayOrder } = razorpayOrderResult;

        const options = {
            key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            name: "PrintEase",
            description: `Print Order #${overallOrderId}`,
            order_id: razorpayOrder.id,
            handler: async (response: any) => {
                setIsSubmitting(true);
                setSubmissionError('Verifying payment...');

                const verificationResult = await verifyRazorpayPayment(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature);

                if (verificationResult.success) {
                    setSubmissionError('Payment successful! Creating print jobs...');
                    
                    const createdJobs: PrintJob[] = [];
                    const createdJobIds: string[] = [];
                    for(const jobData of jobsToCreate) {
                        const creationResult = await createPrintJob(jobData);
                        if (!creationResult.success || !creationResult.id) throw new Error(creationResult.message || `Failed to create job.`);
                        createdJobs.push({ ...jobData, id: creationResult.id, createdAt: new Date().toISOString() });
                        createdJobIds.push(creationResult.id);
                    }
                    
                    await updatePrintJobsWithPayment(createdJobIds, response.razorpay_payment_id, response.razorpay_order_id);

                    setLastSuccessfulJobs(createdJobs);
                    setFiles([]);
                    setBinding('none');
                    setBindingFileNumbers('');
                    setStep(1); 
                } else {
                   setSubmissionError(verificationResult.message || 'Payment verification failed. Please contact support.');
                }
                 setIsSubmitting(false);
            },
            prefill: {
                contact: phoneNumber
            },
            notes: {
                order_id: overallOrderId
            },
            theme: {
                color: "#3F51B5"
            },
            config: {
                display: {
                    blocks: {
                        banks: {
                            name: 'Pay using UPI',
                            instruments: [
                                { method: 'upi' }
                            ]
                        }
                    },
                    sequence: ['block.banks'],
                    preferences: {
                        show_default_blocks: false
                    }
                }
            }
        };

        const rzp = new (window as any).Razorpay(options);
        rzp.on('payment.failed', (response: any) => {
            setSubmissionError(`Payment failed. Error: ${response.error.description}`);
            setIsSubmitting(false);
        });
        rzp.open();
        setIsSubmitting(false);

    } catch (error: any) {
        setSubmissionError(error.message || 'An unknown error occurred during payment initiation.');
        setIsSubmitting(false);
    }
  }

  const handlePlaceAnotherOrder = () => {
    setLastSuccessfulJobs(null);
    setPhoneNumber('');
    setFiles([]);
    setBinding('none');
    setBindingFileNumbers('');
    setStep(1);
  };

  const totalCost = useMemo(() => {
    let total = files.reduce((acc, f) => {
        if (f.status === 'ready_for_config') {
            return acc + (f.cost || 0);
        }
        return acc;
    }, 0);
        
    const filesToBindIndices = binding === 'none' ? [] : parsePageRanges(bindingFileNumbers, files.filter(f => f.status === 'ready_for_config').length);
    const hasDocumentsToBind = files.filter(f => f.status === 'ready_for_config').some((f, i) => !f.isImageFile && filesToBindIndices.includes(i));
    
    if (binding !== 'none' && hasDocumentsToBind && pricing) {
        total += pricing.coverPageFee || 0;
        if (binding === 'spiral') total += pricing.spiralBindingFee || 0;
        else if (binding === 'soft') total += pricing.softBindingFee || 0;
    }

    return total;
  }, [files, pricing, binding, bindingFileNumbers]);

  const filesReadyForConfig = files.filter(f => f.status === 'ready_for_config');
  
  const fileAssignments = useMemo(() => {
    const assignments = new Map<string, { printerName: string | null; error?: string }>();
    if (!printers || printers.length === 0) {
        filesReadyForConfig.forEach(f => assignments.set(f.id, { printerName: null, error: 'No printers online.' }));
        return assignments;
    }
    const onlinePrinters = printers.filter(p => p.status === 'online');
    if (onlinePrinters.length === 0) {
        filesReadyForConfig.forEach(f => assignments.set(f.id, { printerName: null, error: 'No printers online.' }));
        return assignments;
    }

    const tempRotationIndices = new Map(rotationIndices.current);
    const getNextPreviewIndex = (category: string, count: number) => {
        if (count === 0) return 0;
        const currentIndex = tempRotationIndices.get(category) || 0;
        tempRotationIndices.set(category, (currentIndex + 1) % count);
        return currentIndex;
    };

    // Group files by category to simulate the round-robin logic for the UI preview
    const filesByCategory = new Map<string, FileDetails[]>();
    filesReadyForConfig.forEach(f => {
        const category = getFileCategory(f);
        if (!filesByCategory.has(category)) {
            filesByCategory.set(category, []);
        }
        filesByCategory.get(category)!.push(f);
    });

    filesByCategory.forEach((files, category) => {
        const compatiblePrinters = onlinePrinters.filter(p => {
            const file = files[0];
            const caps = p.capabilities || [];
            const duplexCompatible = file.duplex === 'one-sided' || (caps.includes('duplex') || caps.includes('single-sided'));
            return caps.includes(file.printType) && caps.includes(file.paperSize) && duplexCompatible;
        });

        if (compatiblePrinters.length > 0) {
            const printerIndex = getNextPreviewIndex(category, compatiblePrinters.length);
            const assignedPrinter = compatiblePrinters[printerIndex];
            files.forEach(f => assignments.set(f.id, { printerName: assignedPrinter.name }));
        } else {
            files.forEach(f => assignments.set(f.id, { printerName: null, error: 'No compatible printer.' }));
        }
    });

    return assignments;
}, [files, printers]);


  const isStep1Complete = useMemo(() => files.length > 0 && files.every(f => f.status === 'ready_for_config' || f.status === 'error'), [files]);
  const handleNext = () => setStep(currentStep + 1);
  const handleBack = () => setStep(currentStep - 1);
  const isStep4Complete = useMemo(() => files.length > 0 && files.every(f => f.status === 'ready_for_config'), [files]);

  const Step1 = (
    <Card>
      <CardHeader>
        <CardTitle>Step 1: Upload Your Files</CardTitle>
        <CardDescription>Upload PDF, Word, or image files. The process will start automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {files.map((file, index) => (
          <Card key={file.id} className={cn("p-4 relative", index % 2 === 0 ? "bg-blue-50" : "bg-yellow-50")}>
             <div className="absolute top-2 left-2 bg-primary text-primary-foreground h-6 w-6 flex items-center justify-center rounded-full text-sm font-bold">{index + 1}</div>
            <div className="flex items-start gap-4 pl-8">
               {file.previewUrl && file.isImageFile ? (
                <Image src={file.previewUrl} alt="preview" width={48} height={48} className="rounded-md object-cover h-12 w-12" />
              ) : (
                <div className="h-12 w-12 flex items-center justify-center bg-blue-100 rounded-md">
                   <FileUp className="w-6 h-6 text-blue-600" />
                </div>
              )}
              <div className="flex-1">
                <p className="font-semibold">{file.originalFile.name}</p>
                 <p className="text-sm text-muted-foreground">
                    {file.status === 'pending' && 'Waiting to start...'}
                    {(file.status === 'uploading' || file.status === 'getting_id') && file.message}
                    {file.status === 'counting_pages' && file.message}
                    {file.pageCount !== null && `Total of ${file.pageCount} pages.`}
                 </p>
                <div className="mt-2">
                    {(file.status === 'uploading' || file.status === 'getting_id' || file.status === 'counting_pages') && <Progress value={file.progress} className="h-1" />}
                    {file.status === 'error' && (
                         <div className="flex items-center gap-2 text-sm text-red-600 font-medium">
                            <XCircle className="w-4 h-4" />
                            <span>{file.message}</span>
                         </div>
                    )}
                     {file.status === 'ready_for_config' && (
                         <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                             <Check className="w-4 h-4" />
                            <span>Ready to configure</span>
                         </div>
                    )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button variant="ghost" size="icon" onClick={() => removeFile(file.id)} className="h-8 w-8">
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
                {file.status === 'error' && (
                    <Button variant="outline" size="sm" onClick={() => uploadFileAndGetPageCount(file)}>
                        <RefreshCw className="w-3 h-3 mr-1.5" />
                        Retry
                    </Button>
                )}
              </div>
            </div>
             {!file.isImageFile && file.status === 'ready_for_config' && (
                <div className="mt-4 pl-8 md:pl-16">
                    <Label htmlFor={`page-range-${file.id}`} className="font-medium">Page Range (optional)</Label>
                    <Input id={`page-range-${file.id}`} className="mt-1 bg-white" placeholder="e.g., 1-5, 8, 11-13. Leave blank for all." value={file.pageRange} onChange={(e) => updateFileDetails(file.id, { pageRange: e.target.value })}/>
                </div>
            )}
          </Card>
        ))}
         <div className="space-y-2 pt-4">
            <Label htmlFor="file-upload" className="font-semibold">Upload More Files</Label>
            <div className="relative">
                <Input id="file-upload" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,image/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" multiple />
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-white hover:bg-gray-50 cursor-pointer">
                    <FileUp className="mx-auto h-12 w-12 text-gray-400" />
                    <p className="mt-2 text-sm text-muted-foreground">Click or drag to upload</p>
                    <p className="text-xs text-muted-foreground">PDF, DOCX, JPG, PNG supported</p>
                </div>
            </div>
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={handleNext} disabled={!isStep1Complete}>Next <ArrowRight className="ml-2 w-4 h-4" /></Button>
      </CardFooter>
    </Card>
  );

  const Step2 = (
    <Card>
      <CardHeader>
        <CardTitle>Step 2: Print Options</CardTitle>
        <CardDescription>Choose quality, paper size, and copies for your files.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {filesReadyForConfig.map((file, index) => (
            <Card key={file.id} className={cn("p-4 relative", index % 2 === 0 ? "bg-blue-50" : "bg-yellow-50")}>
                 <div className="absolute top-2 left-2 bg-primary text-primary-foreground h-6 w-6 flex items-center justify-center rounded-full text-sm font-bold">{index + 1}</div>
                 <p className="font-semibold text-center mb-4 pt-1">{file.originalFile.name}</p>
                <div className={cn("grid grid-cols-1 pt-4 gap-x-6 gap-y-6 md:grid-cols-3")}>
                    <div>
                        <Label className="font-medium text-sm">Print Quality</Label>
                        <RadioGroup value={file.printType} onValueChange={(v) => updateFileDetails(file.id, { printType: v as any })} className="mt-2 grid grid-cols-2 gap-2">
                           <Label htmlFor={`bw-${file.id}`} className={cn("border rounded-md p-3 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors", file.printType === 'bw' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                                <RadioGroupItem value="bw" id={`bw-${file.id}`} className="sr-only"/>
                                <div className="w-5 h-5 rounded-full bg-black"/>
                                <span className="text-sm font-medium">B&W</span>
                            </Label>
                             <Label htmlFor={`color-${file.id}`} className={cn("border rounded-md p-3 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors", file.printType === 'color' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                                <RadioGroupItem value="color" id={`color-${file.id}`} className="sr-only"/>
                                <Palette className="w-5 h-5 text-cyan-500" />
                                <span className="text-sm font-medium">Color</span>
                            </Label>
                        </RadioGroup>
                    </div>
                    <div className="space-y-2">
                        <Label className="font-medium text-sm">Paper Size</Label>
                        <Select value={file.paperSize} onValueChange={(v) => updateFileDetails(file.id, { paperSize: v as any })}>
                            <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {paperSizes.map(size => (<SelectItem key={size} value={size}>{size}</SelectItem>))}
                            </SelectContent>
                        </Select>
                    </div>
                    {!file.isImageFile && (
                      <div className="space-y-2">
                          <Label className="font-medium text-sm">Copies</Label>
                          <div className="flex items-center gap-1">
                              <Button variant="outline" size="icon" className="h-10 w-10 bg-white" onClick={() => updateFileDetails(file.id, { copies: Math.max(1, file.copies - 1) })}><Minus className="w-4 h-4" /></Button>
                              <Input value={`${file.copies}`} className="w-20 h-10 text-center bg-white font-medium" onChange={(e) => updateFileDetails(file.id, { copies: parseInt(e.target.value) || 1 })}/>
                              <Button variant="outline" size="icon" className="h-10 w-10 bg-white" onClick={() => updateFileDetails(file.id, { copies: file.copies + 1 })}><Plus className="w-4 h-4" /></Button>
                          </div>
                      </div>
                    )}
                </div>
            </Card>
        ))}
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="outline" onClick={handleBack}><ArrowLeft className="mr-2 w-4 h-4" />Back</Button>
        <Button onClick={handleNext}>Next <ArrowRight className="ml-2 w-4 h-4" /></Button>
      </CardFooter>
    </Card>
  );

  const Step3 = (
    <Card>
      <CardHeader>
        <CardTitle>Step 3: Layout & Finishing</CardTitle>
        <CardDescription>
          Finalize orientation, sides, photo layouts, and binding options.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {filesReadyForConfig.map((file, index) => (
          <Card key={file.id} className={cn("p-4 relative overflow-hidden", index % 2 === 0 ? "bg-blue-50" : "bg-yellow-50")}>
            <div className="absolute top-2 left-2 bg-primary text-primary-foreground h-6 w-6 flex items-center justify-center rounded-full text-sm font-bold">{index + 1}</div>
            <p className="font-semibold text-center mb-4 pt-1">{file.originalFile.name}</p>

            {file.isImageFile ? (
              // IMAGE LAYOUT
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Layout</Label>
                      <Select value={file.imageLayout.type} onValueChange={(v) => updateFileDetails(file.id, { imageLayout: { ...file.imageLayout, type: v as any } })}>
                        <SelectTrigger className="bg-white"><SelectValue placeholder="Select a layout" /></SelectTrigger>
                        <SelectContent>
                          {layoutOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                        <Label className="font-medium text-sm">Copies</Label>
                        <div className="flex items-center gap-1">
                            <Button variant="outline" size="icon" className="h-10 w-10 bg-white" onClick={() => updateFileDetails(file.id, { copies: Math.max(1, file.copies - 1) })}><Minus className="w-4 h-4" /></Button>
                            <Input value={`${file.copies}`} className="w-20 h-10 text-center bg-white font-medium" onChange={(e) => updateFileDetails(file.id, { copies: parseInt(e.target.value) || 1 })} />
                            <Button variant="outline" size="icon" className="h-10 w-10 bg-white" onClick={() => updateFileDetails(file.id, { copies: file.copies + 1 })}><Plus className="w-4 h-4" /></Button>
                        </div>
                    </div>
                  </div>
                  <div className="space-y-2 mt-4">
                    <Label>Orientation</Label>
                    <RadioGroup value={file.orientation} onValueChange={(v) => updateFileDetails(file.id, { orientation: v as any })} className="mt-2 grid grid-cols-2 gap-4">
                      <Label htmlFor={`portrait-${file.id}`} className={cn("border rounded-md p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors", file.orientation === 'portrait' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                        <RadioGroupItem value="portrait" id={`portrait-${file.id}`} className="sr-only"/>
                        <div className="w-10 h-14 border-2 border-dashed rounded" />
                        <span>Portrait</span>
                      </Label>
                      <Label htmlFor={`landscape-${file.id}`} className={cn("border rounded-md p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors", file.orientation === 'landscape' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                        <RadioGroupItem value="landscape" id={`landscape-${file.id}`} className="sr-only"/>
                        <div className="w-14 h-10 border-2 border-dashed rounded" />
                        <span>Landscape</span>
                      </Label>
                    </RadioGroup>
                  </div>
                  <div className="flex items-center space-x-2 mt-4">
                    <Checkbox id={`fit-${file.id}`} checked={file.imageLayout.fit === 'contain'} onCheckedChange={(checked) => updateFileDetails(file.id, { imageLayout: { ...file.imageLayout, fit: checked ? 'contain' : 'cover' } })} />
                    <Label htmlFor={`fit-${file.id}`}>Fit picture to frame (prevents cropping)</Label>
                  </div>
                </div>
                <div className="bg-gray-200 rounded-lg flex items-center justify-center p-4 relative">
                  <div className={cn("bg-white shadow-lg rounded-md w-full relative", file.orientation === 'portrait' ? "aspect-[210/297]" : "aspect-[297/210]")}>
                    <div
                      className="grid gap-0.5 p-0.5 h-full w-full"
                      style={{
                        gridTemplateColumns: `repeat(${file.orientation === 'portrait' ? (layoutOptions.find(l => l.value === file.imageLayout.type)?.grid[0] || 1) : (layoutOptions.find(l => l.value === file.imageLayout.type)?.grid[1] || 1)}, 1fr)`,
                        gridTemplateRows: `repeat(${file.orientation === 'portrait' ? (layoutOptions.find(l => l.value === file.imageLayout.type)?.grid[1] || 1) : (layoutOptions.find(l => l.value === file.imageLayout.type)?.grid[0] || 1)}, 1fr)`,
                      }}
                    >
                      {Array.from({ length: Math.min(file.copies, file.imageLayout.photosPerPage) }).map((_, i) => (
                        <div key={i} className="bg-gray-100 flex items-center justify-center overflow-hidden relative">
                          {file.previewUrl && (
                            <Image
                              src={file.previewUrl}
                              alt="preview"
                              fill
                              className={cn("h-full w-full", file.imageLayout.fit === 'contain' ? 'object-contain' : 'object-cover')}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // DOCUMENT LAYOUT
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium mb-2">Orientation</h4>
                  <RadioGroup
                    value={file.orientation}
                    onValueChange={(v) => updateFileDetails(file.id, { orientation: v as any })}
                    className="grid grid-cols-2 gap-2"
                  >
                    <Label htmlFor={`doc-portrait-${file.id}`} className={cn("border rounded-md p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors", file.orientation === 'portrait' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                      <RadioGroupItem value="portrait" id={`doc-portrait-${file.id}`} className="sr-only"/>
                      <div className="w-10 h-14 border-2 border-dashed rounded" />
                      <span>Portrait</span>
                    </Label>
                    <Label htmlFor={`doc-landscape-${file.id}`} className={cn("border rounded-md p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors", file.orientation === 'landscape' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                      <RadioGroupItem value="landscape" id={`doc-landscape-${file.id}`} className="sr-only"/>
                      <div className="w-14 h-10 border-2 border-dashed rounded" />
                      <span>Landscape</span>
                    </Label>
                  </RadioGroup>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Printing Sides</h4>
                  <RadioGroup 
                    value={file.duplex}
                    onValueChange={(v) => updateFileDetails(file.id, { duplex: v as any })}
                    className="space-y-2">
                    <Label htmlFor={`doc-single-${file.id}`} className={cn("border rounded-md p-3 flex items-center gap-3 cursor-pointer", file.duplex === 'one-sided' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                      <RadioGroupItem value="one-sided" id={`doc-single-${file.id}`} className="sr-only"/>
                      Single Side
                    </Label>
                     <Label htmlFor={`doc-double-book-${file.id}`} className={cn("border rounded-md p-3 flex items-center gap-3 cursor-pointer", file.duplex === 'duplex-long-edge' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                      <RadioGroupItem value="duplex-long-edge" id={`doc-double-book-${file.id}`} className="sr-only"/>
                      Double-Sided (Book)
                      <FlipHorizontal className="w-4 h-4 ml-auto text-muted-foreground" />
                    </Label>
                     <Label htmlFor={`doc-double-notepad-${file.id}`} className={cn("border rounded-md p-3 flex items-center gap-3 cursor-pointer", file.duplex === 'duplex-short-edge' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                      <RadioGroupItem value="duplex-short-edge" id={`doc-double-notepad-${file.id}`} className="sr-only"/>
                      Double-Sided (Notepad)
                       <FlipVertical className="w-4 h-4 ml-auto text-muted-foreground" />
                    </Label>
                  </RadioGroup>
                </div>
              </div>
            )}
          </Card>
        ))}
        
        {filesReadyForConfig.some(f => !f.isImageFile) && (
            <div>
              <h3 className="text-lg font-semibold mb-2">Binding Options</h3>
              <RadioGroup value={binding} onValueChange={(v) => setBinding(v as any)} className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                <Label htmlFor="none" className={cn("border rounded-lg p-4 cursor-pointer transition-colors", binding === 'none' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                  <RadioGroupItem value="none" id="none" className="sr-only"/>
                  <div className="font-bold mb-1">No Binding</div>
                  <p className="text-sm text-muted-foreground">All files printed separately.</p>
                </Label>
                <Label htmlFor="spiral" className={cn("border rounded-lg p-4 cursor-pointer transition-colors", binding === 'spiral' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                  <RadioGroupItem value="spiral" id="spiral" className="sr-only"/>
                  <div className="font-bold mb-1">Spiral Binding</div>
                  <p className="text-sm text-muted-foreground">Comb binding for documents.</p>
                   {binding === 'spiral' && (
                        <div className="mt-4">
                            <Label htmlFor="spiral-files" className="text-xs font-semibold">Bind files:</Label>
                            <Input
                                id="spiral-files"
                                value={bindingFileNumbers}
                                onChange={(e) => setBindingFileNumbers(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 h-8 bg-white"
                                placeholder="e.g., 1, 2, 4"
                            />
                        </div>
                   )}
                </Label>
                <Label htmlFor="soft" className={cn("border rounded-lg p-4 cursor-pointer transition-colors", binding === 'soft' ? 'bg-primary/20 border-primary ring-2 ring-primary' : 'bg-white hover:bg-gray-50')}>
                  <RadioGroupItem value="soft" id="soft" className="sr-only"/>
                  <div className="font-bold mb-1">Soft Binding</div>
                  <p className="text-sm text-muted-foreground">A simple, flexible cover.</p>
                  {binding === 'soft' && (
                        <div className="mt-4">
                            <Label htmlFor="soft-files" className="text-xs font-semibold">Bind files:</Label>
                            <Input
                                id="soft-files"
                                value={bindingFileNumbers}
                                onChange={(e) => setBindingFileNumbers(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 h-8 bg-white"
                                placeholder="e.g., 1, 2, 4"
                            />
                        </div>
                   )}
                </Label>
              </RadioGroup>
            </div>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <Button variant="outline" onClick={handleBack}><ArrowLeft className="mr-2 w-4 h-4" />Back</Button>
        <Button onClick={handleNext}>Next <ArrowRight className="ml-2 w-4 h-4" /></Button>
      </CardFooter>
    </Card>
  );

  const Step4 = (
    <Card>
        <CardHeader>
            <CardTitle>Step 4: Confirm & Pay</CardTitle>
            <CardDescription>Review your order details and submit for printing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
             <div>
                <h3 className="font-semibold text-lg mb-2">Order Summary</h3>
                <div className="border rounded-lg bg-white divide-y">
                    {filesReadyForConfig.map((file, index) => {
                        const assignment = fileAssignments.get(file.id);
                        return (
                        <div key={file.id} className={cn("p-3 flex flex-col md:flex-row justify-between items-start md:items-center text-sm gap-2", index % 2 === 0 ? "bg-blue-50/50" : "bg-yellow-50/50")}>
                            <div className='flex-1'>
                                <p className="font-medium truncate pr-4"><span className="font-bold mr-2">{index+1}.</span>{file.originalFile.name}</p>
                                <div className='md:hidden mt-2 flex items-center gap-2'>
                                    {assignment?.printerName ? (
                                        <Badge variant="secondary" className="flex items-center gap-1.5">
                                            <PrinterIcon className="w-3 h-3" /> {assignment.printerName}
                                        </Badge>
                                    ) : (
                                        <Badge variant="destructive">
                                            {assignment?.error || 'No Printer'}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-muted-foreground flex-shrink-0">
                                 <div className='hidden md:flex items-center'>
                                    {assignment?.printerName ? (
                                        <Badge variant="secondary" className="flex items-center gap-1.5">
                                            <PrinterIcon className="w-3 h-3" /> {assignment.printerName}
                                        </Badge>
                                    ) : (
                                        <Badge variant="destructive">
                                            {assignment?.error || 'No Printer'}
                                        </Badge>
                                    )}
                                </div>
                                <span>{file.printType === 'bw' ? 'B&W' : 'Color'}</span>
                                <span>{file.paperSize.toUpperCase()}</span>
                                <span>{file.copies}x</span>
                            </div>
                        </div>
                    )})}
                     {binding !== 'none' && filesReadyForConfig.some(f => !f.isImageFile) && <div className="p-3 flex justify-between items-center text-sm">
                        <p className="font-medium">Binding ({bindingFileNumbers})</p>
                        <span className="text-muted-foreground capitalize">{binding}</span>
                     </div>}
                </div>
            </div>
            
             <div>
                <h3 className="font-semibold text-lg mb-2">Total Cost</h3>
                <div className="border rounded-lg bg-purple-50 p-4 text-center">
                    <p className="text-4xl font-bold">₹{totalCost.toFixed(2)}</p>
                </div>
            </div>
            <div>
                <Label htmlFor='phoneNumber' className="font-semibold text-lg mb-2 block">Phone Number</Label>
                <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="phoneNumber" placeholder="Enter your phone number" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="pl-9 bg-white" required />
                </div>
            </div>

            {submissionError && <p className="text-sm text-red-600 text-center">{submissionError}</p>}
            {!isStep4Complete && <p className="text-sm text-red-600 text-center">Please ensure all files are configured to submit.</p>}
        </CardContent>
        <CardFooter className="justify-between">
            <Button variant="outline" onClick={handleBack}><ArrowLeft className="mr-2 w-4 h-4" />Back</Button>
            <Button size="lg" disabled={!isStep4Complete || isSubmitting || !isRazorpayReady || !phoneNumber} onClick={handleSubmit}>
                {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Pay & Submit
            </Button>
        </CardFooter>
    </Card>
  );

  const renderStep = () => {
    switch (currentStep) {
      case 1: return Step1;
      case 2: return Step2;
      case 3: return Step3;
      case 4: return Step4;
      default: return Step1;
    }
  };

  if (lastSuccessfulJobs) {
    const totalCost = lastSuccessfulJobs.reduce((acc, job) => acc + job.cost, 0);
    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <Card>
                <CardHeader className="items-center text-center">
                    <CheckCircle className="w-16 h-16 text-green-500" />
                    <CardTitle className="text-3xl">Order Placed Successfully!</CardTitle>
                    <CardDescription>Thank you. Your order is now in the print queue.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex justify-between items-center text-lg font-bold p-4 border rounded-lg bg-green-50 text-green-900">
                        <span>Total Cost</span>
                        <span>Rs. {totalCost.toFixed(2)}</span>
                    </div>
                    <div className="space-y-2">
                        <h3 className="font-semibold">Details</h3>
                        <div className="border rounded-lg p-4 space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Order ID:</span>
                                <span className="font-mono">{lastSuccessfulJobs[0]?.orderId}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Printers Used:</span>
                                <span className="font-medium">{lastSuccessfulJobs.length}</span>
                            </div>
                            {binding !== 'none' && lastSuccessfulJobs.some(j => j.binding) && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Binding:</span>
                                <span className="capitalize">{binding}</span>
                            </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="space-y-4">
                        <h3 className="font-semibold">Submitted Jobs</h3>
                        {lastSuccessfulJobs.map((job) => (
                            <div key={job.id} className="border rounded-lg p-4">
                                <div className="flex justify-between items-center mb-3">
                                    <p className="font-semibold flex items-center gap-2">
                                        <PrinterIcon className="w-4 h-4 text-muted-foreground"/>
                                        {job.name}
                                    </p>
                                    <Badge variant="secondary">Job ID: {job.id.substring(0, 8)}...</Badge>
                                </div>
                                <Separator className="mb-3"/>
                                <div className="space-y-2">
                                {job.files.map((file, index) => (
                                    <div key={index} className="flex items-center justify-between text-sm">
                                        <p className="flex items-center gap-2">
                                            {file.isImageFile ? <ImageIcon className="w-4 h-4 text-muted-foreground"/> : <FileUp className="w-4 h-4 text-muted-foreground"/>}
                                            {file.originalFileName}
                                        </p>
                                        <p className="text-muted-foreground">{file.copies}x</p>
                                    </div>
                                ))}
                                </div>
                            </div>
                        ))}
                    </div>

                </CardContent>
                <CardFooter>
                    <Button onClick={handlePlaceAnotherOrder} size="lg" className="w-full">
                        Place Another Order
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
  }

  return (
    <>
       <Script
        id="razorpay-checkout-js"
        src="https://checkout.razorpay.com/v1/checkout.js"
        onLoad={() => {
          setIsRazorpayReady(true);
        }}
      />
      {renderStep()}
    </>
  );
}
