

'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, ArrowRight, Check, CheckCircle, ChevronLeft, ChevronRight, FileUp, FlipHorizontal, FlipVertical, Image as ImageIcon, Loader2, Minus, Palette, Phone, Plus, Printer as PrinterIcon, RefreshCw, Trash2, User, XCircle, PlusCircle, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { PrintJob, Printer, Pricing, FileInJob, ImageLayout, ImageFile } from '@/lib/types';
import { requestPageCount, createPrintJob, getPricing, createRazorpayOrder, verifyRazorpayPayment, updatePrintJobsWithPayment } from '@/lib/firebase/actions';
import { streamFileToConnector, getConnectorInfo } from '@/lib/stream-client';
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

interface SubFileDetails {
    id: string;
    originalFile: File;
    previewUrl?: string;
    streamSessionId: string | null;
    status: 'pending' | 'uploading' | 'complete' | 'error';
    progress: number;
    message?: string;
}

interface FileDetails {
    id: string;
    isGroup: boolean; // Is this a single file or a group of images?
    
    // Single file properties
    originalFile?: File; 
    jobId?: string; // For page count requests
    pageCount: number | null;
    isWordFile: boolean;
    isImageFile: boolean;
    pageRange: string;
    
    // Group properties
    imageFiles: SubFileDetails[];
    
    // Shared properties
    printType: 'bw' | 'color';
    copies: number;
    duplex: FileInJob['duplex'];
    paperSize: FileInJob['paperSize'];
    imageLayout: ImageLayout;
    orientation: FileInJob['orientation'];
    cost: number;
    status: 'pending' | 'uploading' | 'counting_pages' | 'ready_for_config' | 'processing' | 'complete' | 'error';
    progress: number; // For single files or average for groups
    message?: string;
    streamSessionId: string | null;
}


const paperSizes: FileInJob['paperSize'][] = ['A4', 'A3', 'A2', 'A1', 'A0'];
const isLargeFormat = (paperSize?: FileInJob['paperSize']) => paperSize === 'A2' || paperSize === 'A1' || paperSize === 'A0';

const layoutOptions: { value: ImageLayout['type']; label: string; subtitle: string; photosPerPage: number, grid: [number, number] }[] = [
  { value: 'full-page', label: 'Full Page', subtitle: '1 photo per page', photosPerPage: 1, grid: [1, 1] },
  { value: '2-up', label: '2 per Page', subtitle: '~prints 2-up', photosPerPage: 2, grid: [1, 2] },
  { value: '4-up', label: '4 per Page', subtitle: '~prints 4-up', photosPerPage: 4, grid: [2, 2] },
  { value: '9-up', label: '9 per Page', subtitle: 'Wallet size', photosPerPage: 9, grid: [3, 3] },
  { value: 'contact-sheet', label: 'Contact Sheet', subtitle: '35 per page', photosPerPage: 35, grid: [5, 7] },
];


interface OrderFormProps {
    initialPrinters: Printer[];
    currentStep: number;
    setStep: (step: number) => void;
}

// Global counter for user-based round-robin.
let userOrderCounter = 0;

function getFileCategory(file: FileInJob | FileDetails): string {
    const paperSize = file.isGroup ? file.paperSize : file.paperSize;
    const printType = file.isGroup ? file.printType : file.printType;
    return `${printType}-${paperSize}`;
}


export function OrderForm({ initialPrinters, currentStep, setStep }: OrderFormProps) {
  const { toast } = useToast();
  const [isRazorpayReady, setIsRazorpayReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<FileDetails[]>([]);
  const [binding, setBinding] = useState<'none' | 'spiral' | 'soft'>('none');
  const [bindingFileNumbers, setBindingFileNumbers] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSuccessfulJobs, setLastSuccessfulJobs] = useState<PrintJob[] | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [printers, setPrinters] = useState<Printer[]>(initialPrinters);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [previewPages, setPreviewPages] = useState<Record<string, number>>({});

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
    return;
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
  
  const updateFileDetails = (id: string, newDetails: Partial<Omit<FileDetails, 'id'>>) => {
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
           // Update main status based on children statuses
            if (updatedFile.isGroup) {
                const statuses = updatedFile.imageFiles.map(sf => sf.status);
                if (statuses.some(s => s === 'error')) updatedFile.status = 'error';
                else if (statuses.every(s => s === 'complete')) {
                    updatedFile.status = 'ready_for_config';
                    updatedFile.message = 'Ready to configure.';
                }
                else if (statuses.some(s => s === 'uploading')) updatedFile.status = 'uploading';
                else updatedFile.status = 'pending';
                
                const totalProgress = updatedFile.imageFiles.reduce((acc, sf) => acc + sf.progress, 0);
                updatedFile.progress = updatedFile.imageFiles.length > 0 ? totalProgress / updatedFile.imageFiles.length : 0;
            }

          return updatedFile;
        }
        return f;
      })
    );
  };
   const updateSubFileDetails = (groupId: string, subFileId: string, newDetails: Partial<SubFileDetails>) => {
        setFiles(currentFiles => 
            currentFiles.map(group => {
                if (group.id === groupId && group.isGroup) {
                    const newImageFiles = group.imageFiles.map(subFile => 
                        subFile.id === subFileId ? { ...subFile, ...newDetails } : subFile
                    );
                    
                    const updatedGroup = { ...group, imageFiles: newImageFiles };

                    // After updating the sub-file, check the status of the entire group
                    const statuses = newImageFiles.map(sf => sf.status);
                    if (statuses.some(s => s === 'error')) {
                        updatedGroup.status = 'error';
                    } else if (statuses.every(s => s === 'complete')) {
                        updatedGroup.status = 'ready_for_config';
                        updatedGroup.message = 'Ready to configure.';
                    } else if (statuses.some(s => s === 'uploading')) {
                        updatedGroup.status = 'uploading';
                    } else {
                        updatedGroup.status = 'pending';
                    }

                    const totalProgress = newImageFiles.reduce((acc, sf) => acc + sf.progress, 0);
                    updatedGroup.progress = newImageFiles.length > 0 ? totalProgress / newImageFiles.length : 0;
                    
                    return updatedGroup;
                }
                return group;
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
          const imageCount = currentFile.isGroup ? currentFile.imageFiles.length : 1;
          
          if (currentFile.imageLayout.type === 'contact-sheet') {
              // Price per image for contact sheets
              fileCost = imageCount * 10 * currentFile.copies;
          } else {
              // Price per sheet for other layouts
              const sheetsNeeded = Math.ceil((imageCount * currentFile.copies) / photosPerPage);
              let sheetCost = 0;

              if (currentFile.printType === 'bw') {
                  sheetCost = 2; // 2 Rs for B/W sheet
              } else {
                  sheetCost = 10; // 10 Rs for Color sheet
              }
              fileCost = sheetsNeeded * sheetCost;
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
  }, [JSON.stringify(files.map(f => `${f.id}-${f.status}-${f.pageRange}-${f.copies}-${f.printType}-${f.duplex}-${f.paperSize}-${f.imageLayout.type}-${f.isGroup ? f.imageFiles.length : 1}`)), pricing]);

  const handleWordPageCount = async (fileId: string, streamSessionId: string, originalFileName: string) => {
    let unsubscribe: (() => void) | null = null;
    try {
        updateFileDetails(fileId, { status: 'counting_pages', message: 'Requesting page count...' });
        const result = await requestPageCount(streamSessionId, originalFileName);
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

  const uploadFileAndGetPageCount = useCallback(async (file: File, isWordFile: boolean, fileId: string, groupId?: string, subFileId?: string) => {
    
    const updateTarget = (details: Partial<SubFileDetails> | Partial<FileDetails>) => {
        if (groupId && subFileId) {
            updateSubFileDetails(groupId, subFileId, details);
        } else {
            updateFileDetails(fileId, details);
        }
    };
    
    updateTarget({ status: 'uploading', progress: 5, message: 'Preparing file...' });

    try {
        const sessionId = uuidv4();
        updateTarget({ progress: 15, message: 'Connecting to printer...' });

        const info = await getConnectorInfo();
        const relayUrl = process.env.NEXT_PUBLIC_RELAY_URL || 'ws://localhost:9786';
        
        const abortController = new AbortController();
        const result = await streamFileToConnector(
            file,
            sessionId,
            info.host,
            info.port,
            relayUrl,
            (pct) => {
                const adjusted = 15 + Math.round(pct * 0.75);
                updateTarget({ progress: adjusted, message: pct < 100 ? `Streaming... ${pct}%` : 'Finalizing...' });
            },
            abortController.signal
        );

        if (!result.success) {
            throw new Error(result.message || 'File streaming failed.');
        }

        updateTarget({ streamSessionId: sessionId, progress: 100, status: 'complete', message: 'Upload complete.' });

        if (isWordFile && !groupId) {
            await handleWordPageCount(fileId, sessionId, file.name);
        } else if (!groupId) {
             updateFileDetails(fileId, { status: 'ready_for_config', message: 'Ready to configure.' });
        } else {
            setFiles(currentFiles => {
                const group = currentFiles.find(f => f.id === groupId);
                if (group && group.isGroup && group.imageFiles.every(sf => sf.status === 'complete')) {
                    return currentFiles.map(f => f.id === groupId ? { ...f, status: 'ready_for_config', message: 'Ready to configure.' } : f);
                }
                return currentFiles;
            });
        }
    } catch (error: any) {
        console.error("Error in uploadFileAndGetPageCount:", error);
        updateTarget({ status: 'error', message: error.message || 'Could not stream file to printer.' });
    }
  }, []);


  const processNewFiles = useCallback((newFiles: File[]) => {
    setSubmissionError(null);
    if(lastSuccessfulJobs) setLastSuccessfulJobs(null);

    const newFileDetails: FileDetails[] = newFiles.map(file => {
      const isImage = file.type.startsWith('image/') || /\.(heic|heif|heics|heifs|avif|webp|png|jpe?g|gif|bmp|tiff?)$/i.test(file.name);
      const isWord = file.type.includes('wordprocessingml') || /\.docx?$/i.test(file.name);
      
      const fileId = uuidv4();
      const subFile: SubFileDetails = {
          id: uuidv4(), originalFile: file, previewUrl: '',
          streamSessionId: null,
          status: 'pending', progress: 0
      };

      const reader = new FileReader();
      reader.onload = async (event) => {
          const result = event.target?.result as string;
           if (isImage) {
                setFiles(current => current.map(f => {
                    if (f.id === fileId) {
                        const newImageFiles = f.imageFiles.map(sf => sf.id === subFile.id ? { ...sf, previewUrl: result } : sf);
                        return { ...f, imageFiles: newImageFiles };
                    }
                    return f;
                }));
           }
          
           uploadFileAndGetPageCount(file, isWord, fileId, isImage ? fileId : undefined, isImage ? subFile.id : undefined);

           if (!isImage && file.type === 'application/pdf') {
                try {
                    const pdfjsLib = await import('pdfjs-dist');
                    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                    updateFileDetails(fileId, { pageCount: pdf.numPages, status: 'ready_for_config', message: 'Ready to configure.' });
                } catch (pdfError) {
                    console.error("Error reading PDF:", pdfError);
                    updateFileDetails(fileId, { status: 'error', message: 'Could not read PDF page count.' });
                }
            }
      };
      reader.onerror = () => {
          updateFileDetails(fileId, { status: 'error', message: 'Could not read file for preview.' });
      };
      reader.readAsDataURL(file);

      // Always treat images as groups, even if it's a single image.
      // This ensures they go through the collage layout logic.
      if (isImage) {
          return {
              id: fileId, isGroup: true, imageFiles: [subFile],
              pageCount: 1, // A single image is one page/item
              isWordFile: false, isImageFile: true,
              printType: 'color', copies: 1, pageRange: 'all', duplex: 'one-sided',
              paperSize: 'A4', orientation: 'auto',
              imageLayout: { type: 'full-page', photosPerPage: 1, fit: 'contain' },
              cost: 0, progress: 0, status: 'pending', message: 'Processing images...',
              streamSessionId: null
          };
      } else {
          return {
              id: fileId, isGroup: false, originalFile: file, imageFiles: [],
              pageCount: null, isWordFile: isWord, isImageFile: false,
              streamSessionId: null, printType: 'bw', copies: 1, pageRange: '',
              duplex: 'one-sided', paperSize: 'A4', orientation: 'portrait',
              imageLayout: { type: 'full-page', photosPerPage: 1, fit: 'contain' },
              cost: 0, progress: 0, status: 'pending',
          };
      }
    });

    setFiles(current => [...current, ...newFileDetails]);
  }, [lastSuccessfulJobs, uploadFileAndGetPageCount]);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;
    processNewFiles(Array.from(selectedFiles));
    if (fileInputRef.current) fileInputRef.current.value = ''; // Reset file input
  };
  
  const removeFile = (id: string) => {
    setFiles(files => files.filter(f => f.id !== id));
  };

  const removeSubFile = (groupId: string, subFileId: string) => {
    setFiles(currentFiles => currentFiles.map(group => {
        if (group.id === groupId && group.isGroup) {
            const newImageFiles = group.imageFiles.filter(sf => sf.id !== subFileId);
            return { ...group, imageFiles: newImageFiles };
        }
        return group;
    }).filter(g => !g.isGroup || g.imageFiles.length > 0)); // Remove empty groups
  };
  
  const handleAddPhotos = (groupId: string) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = (e) => {
          const target = e.target as HTMLInputElement;
          const newPhotos = Array.from(target.files || []);
          if (newPhotos.length > 0) {
              const newSubFiles: SubFileDetails[] = newPhotos.map(p => ({
                  id: uuidv4(), originalFile: p, previewUrl: '',
                  streamSessionId: null,
                  status: 'pending', progress: 0
              }));

              setFiles(current => current.map(f => f.id === groupId ? { ...f, imageFiles: [...f.imageFiles, ...newSubFiles] } : f));
              
              newSubFiles.forEach(subFile => {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                      updateSubFileDetails(groupId, subFile.id, { previewUrl: event.target?.result as string });
                      uploadFileAndGetPageCount(subFile.originalFile, false, groupId, groupId, subFile.id);
                  };
                  reader.readAsDataURL(subFile.originalFile);
              });
          }
      };
      input.click();
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

    const fileDetailsToJobs = (details: FileDetails[]): FileInJob[] => {
      return details.map(f => {
          if (f.isGroup) {
              const imageFiles: ImageFile[] = f.imageFiles.map(sf => ({
                  originalFileName: sf.originalFile.name,
                  streamSessionId: sf.streamSessionId!,
                  uniqueFileName: sf.originalFile.name,
              }));
              return {
                  isGroup: true,
                  imageFiles: imageFiles,
                  originalFileName: f.imageFiles.length > 1 ? "Image Collage" : f.imageFiles[0].originalFile.name,
                  fileName: `collage-${f.id}`,
                  streamSessionId: 'group', // Placeholder
                  isWordFile: false, isImageFile: true, pageCount: f.imageFiles.length, pageRange: 'all',
                  copies: f.copies, printType: f.printType, paperSize: f.paperSize, imageLayout: f.imageLayout,
                  orientation: f.orientation, duplex: 'one-sided', // Duplex doesn't apply to photo sheets
              };
          } else {
              return {
                  isGroup: false,
                  fileName: f.originalFile!.name, originalFileName: f.originalFile!.name, streamSessionId: f.streamSessionId!,
                  isWordFile: f.isWordFile, isImageFile: f.isImageFile, pageCount: f.pageCount!, pageRange: f.pageRange.trim() || 'all',
                  copies: f.copies, printType: f.printType, paperSize: f.paperSize,
                  orientation: f.orientation, duplex: f.duplex,
              };
          }
      });
    };

    const isPrinterCompatible = (printer: Printer, file: FileDetails) => {
        const caps = printer.capabilities || [];
        const duplexCompatible = file.duplex === 'one-sided' || caps.includes('duplex');
        return caps.includes(file.printType) && caps.includes(file.paperSize) && duplexCompatible;
    };

    // --- NEW ASSIGNMENT LOGIC ---
    // 1. Try to find a single printer for the whole order.
    const allCompatiblePrinters = onlinePrinters.filter(p => 
        filesToSubmit.every(f => isPrinterCompatible(p, f))
    );

    let strategy: 'user-based' | 'job-based' = 'job-based';
    let assignedUserPrinter: Printer | null = null;

    if (allCompatiblePrinters.length > 0) {
        strategy = 'user-based';
        const printerIndex = userOrderCounter % allCompatiblePrinters.length;
        assignedUserPrinter = allCompatiblePrinters[printerIndex];
        userOrderCounter++; // Increment for the next user.
    }

    if (strategy === 'user-based' && assignedUserPrinter) {
        // --- User-Based Assignment ---
        console.log(`Assigning all jobs for order ${overallOrderId} to printer: ${assignedUserPrinter.name}`);
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

        // Create a single job for all bound files
        if (boundFileDetails.length > 0) {
            const boundFilesForJob = fileDetailsToJobs(boundFileDetails);
            const cost = boundFileDetails.reduce((acc, f) => acc + (f.cost || 0), 0);
            jobsToCreate.push({
                orderType: 'print', status: 'pending-payment', printerId: assignedUserPrinter.id, name: assignedUserPrinter.name, cost,
                username: "Customer", orderId: overallOrderId, binding: binding, files: boundFilesForJob, phoneNumber,
            });
        }
        
        // Create one job for all unbound files
        if (unboundFileDetails.length > 0) {
            const unboundFilesForJob = fileDetailsToJobs(unboundFileDetails);
            const cost = unboundFileDetails.reduce((acc, f) => acc + (f.cost || 0), 0);
            jobsToCreate.push({
                orderType: 'print', status: 'pending-payment', printerId: assignedUserPrinter.id, name: assignedUserPrinter.name, cost,
                username: "Customer", orderId: overallOrderId, binding: undefined, files: unboundFilesForJob, phoneNumber,
            });
        }
    } else {
        // --- Fallback to Job-Based Assignment ---
        console.log(`No single printer compatible for all jobs. Falling back to job-based assignment for order ${overallOrderId}.`);
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

        if (boundFileDetails.length > 0) {
            const boundFilesForJob = fileDetailsToJobs(boundFileDetails);
            const cost = boundFileDetails.reduce((acc, f) => acc + (f.cost || 0), 0);
            
            const compatiblePrinters = onlinePrinters.filter(p => boundFileDetails.every(f => isPrinterCompatible(p, f))).sort((a,b) => (a.queueLength || 0) - (b.queueLength || 0));

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
            const compatiblePrinters = onlinePrinters.filter(p => isPrinterCompatible(p, filesForCategory[0]));

            if (compatiblePrinters.length === 0) {
                filesForCategory.forEach(f => updateFileDetails(f.id, { status: 'error', message: `No compatible printer for this file type.` }));
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
        categoriesToAdvance.forEach(category => {
            const compatiblePrinters = onlinePrinters.filter(p => isPrinterCompatible(p, jobsByCategory.get(category)![0]));
            advanceIndex(category, compatiblePrinters.length);
        });
    }

    if (jobsToCreate.length === 0 && filesToSubmit.length > 0) {
        const firstError = files.find(f => f.status === 'error')?.message;
        setSubmissionError(firstError || 'Could not assign any files to a compatible printer.');
        setIsSubmitting(false);
        return;
    }
    
    try {
        setSubmissionError('Creating jobs...');
        const createdJobs: PrintJob[] = [];
        const createdJobIds: string[] = [];

        for(const jobData of jobsToCreate) {
            const creationResult = await createPrintJob(jobData);
            if (!creationResult.success || !creationResult.id) {
                // Attempt to clean up already created jobs if one fails
                if (createdJobIds.length > 0) {
                    console.warn("Rolling back pending-payment jobs due to creation failure.");
                    // This is a soft delete, a proper rollback would be more complex
                    await updatePrintJobsWithPayment(createdJobIds, "FAILED", "FAILED");
                }
                throw new Error(creationResult.message || `Failed to create job.`);
            }
            createdJobs.push({ ...jobData, id: creationResult.id, createdAt: new Date().toISOString() });
            createdJobIds.push(creationResult.id);
        }

        const finalTotalCost = jobsToCreate.reduce((acc, job) => acc + job.cost, 0);
        setSubmissionError('Redirecting to payment...');

        const razorpayOrderResult = await createRazorpayOrder(finalTotalCost, 'INR', overallOrderId);
        if (!razorpayOrderResult.success || !razorpayOrderResult.order) {
            throw new Error(razorpayOrderResult.message || 'Could not create Razorpay order.');
        }

        const { order: razorpayOrder } = razorpayOrderResult;

        const options = {
            key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            name: "PrintEx",
            description: `Print Order #${overallOrderId}`,
            order_id: razorpayOrder.id,
            handler: async (response: any) => {
                setIsSubmitting(true);
                setSubmissionError('Verifying payment...');

                const verificationResult = await verifyRazorpayPayment(response.razorpay_order_id, response.razorpay_payment_id, response.razorpay_signature);

                if (verificationResult.success) {
                    setSubmissionError('Payment successful! Finalizing print jobs...');
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
            modal: {
                ondismiss: async () => {
                    // This is important. If user closes the modal, we don't want to leave them in a submitting state.
                    setIsSubmitting(false);
                    setSubmissionError('Payment was not completed.');
                    
                    // Update job status to cancelled
                    await updatePrintJobsWithPayment(createdJobIds, "CANCELLED", razorpayOrder.id, 'cancelled');

                    toast({
                        title: "Payment Cancelled",
                        description: "Your order was not completed. Please try again.",
                        variant: "destructive"
                    });
                }
            },
            method: {
                upi: true,
                card: false,
                netbanking: false,
                wallet: false,
            },
            upi: {
                flow: "intent"
            },
        };

        const rzp = new (window as any).Razorpay(options);
        rzp.on('payment.failed', async (response: any) => {
            setSubmissionError(`Payment failed. Error: ${response.error.description}`);
            setIsSubmitting(false);
            await updatePrintJobsWithPayment(createdJobIds, response.error.metadata.payment_id, response.error.metadata.order_id, 'error');
        });
        rzp.open();
        // Don't set submitting to false here, because the Razorpay modal is now controlling the flow.
        // It will be set to false in the handler or on dismiss.

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
        <CardDescription>Upload PDF, Word, or image files. Photos will be grouped for collages.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {files.map((file, index) => (
          <Card key={file.id} className={cn("p-4 relative", index % 2 === 0 ? "bg-blue-50" : "bg-yellow-50")}>
             <div className="absolute top-2 left-2 bg-primary text-primary-foreground h-6 w-6 flex items-center justify-center rounded-full text-sm font-bold">{index + 1}</div>
            <div className="flex items-start gap-4 pl-8">
               {file.isGroup ? (
                 <div className="h-12 w-12 flex items-center justify-center bg-purple-100 rounded-md">
                   <ImageIcon className="w-6 h-6 text-purple-600" />
                </div>
               ) : (
                <div className="h-12 w-12 flex items-center justify-center bg-blue-100 rounded-md">
                   <FileUp className="w-6 h-6 text-blue-600" />
                </div>
              )}
              <div className="flex-1">
                <p className="font-semibold">{file.isGroup ? (file.imageFiles.length > 1 ? `Image Collage (${file.imageFiles.length} photos)` : file.imageFiles[0]?.originalFile.name || 'Image') : file.originalFile?.name}</p>
                 <p className="text-sm text-muted-foreground">
                    {file.status === 'pending' && 'Waiting to start...'}
                    {(file.status === 'uploading') && file.message}
                    {file.status === 'counting_pages' && file.message}
                    {!file.isGroup && file.pageCount !== null && `Total of ${file.pageCount} pages.`}
                 </p>
                <div className="mt-2">
                    {(file.status === 'uploading' || file.status === 'counting_pages') && <Progress value={file.progress} className="h-1" />}
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
                    <Button variant="outline" size="sm" onClick={() => file.isGroup ? file.imageFiles.forEach(sf => { if(sf.status === 'error') uploadFileAndGetPageCount(sf.originalFile, false, file.id, file.id, sf.id) }) : uploadFileAndGetPageCount(file.originalFile!, file.isWordFile, file.id)}>
                        <RefreshCw className="w-3 h-3 mr-1.5" />
                        Retry
                    </Button>
                )}
              </div>
            </div>

            {file.isGroup && (
                <div className="mt-4 pl-8 md:pl-16 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {file.imageFiles.map(sf => (
                             <div key={sf.id} className="relative aspect-square group">
                                {sf.previewUrl ? (
                                    <Image src={sf.previewUrl} alt="preview" fill className="rounded-md object-cover" />
                                ) : (
                                    <div className="w-full h-full bg-gray-200 rounded-md flex items-center justify-center">
                                        <Loader2 className="w-5 h-5 animate-spin text-gray-500"/>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <Button variant="destructive" size="icon" className="h-7 w-7" onClick={() => removeSubFile(file.id, sf.id)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                                {sf.status === 'error' && <div className="absolute bottom-1 right-1 bg-red-500 text-white rounded-full p-0.5"><XCircle className="w-3 h-3"/></div>}
                             </div>
                        ))}
                         <button onClick={() => handleAddPhotos(file.id)} className="aspect-square border-2 border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground hover:bg-gray-100 hover:border-primary hover:text-primary transition-colors">
                            <PlusCircle className="w-6 h-6" />
                            <span className="text-xs mt-1">Add Photos</span>
                        </button>
                    </div>
                </div>
            )}
             {!file.isGroup && !file.isImageFile && file.status === 'ready_for_config' && (
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
                <Input id="file-upload" type="file" ref={fileInputRef} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.gif,.bmp,.tiff,.tif,image/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" multiple />
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
                 <p className="font-semibold text-center mb-4 pt-1">{file.isGroup ? `Image Collage (${file.imageFiles.length} photos)` : file.originalFile?.name}</p>
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
                    
                      <div className="space-y-2">
                          <Label className="font-medium text-sm">Copies</Label>
                          <div className="flex items-center gap-1">
                              <Button variant="outline" size="icon" className="h-10 w-10 bg-white" onClick={() => updateFileDetails(file.id, { copies: Math.max(1, file.copies - 1) })}><Minus className="w-4 h-4" /></Button>
                              <Input value={`${file.copies}`} className="w-20 h-10 text-center bg-white font-medium" onChange={(e) => updateFileDetails(file.id, { copies: parseInt(e.target.value) || 1 })}/>
                              <Button variant="outline" size="icon" className="h-10 w-10 bg-white" onClick={() => updateFileDetails(file.id, { copies: file.copies + 1 })}><Plus className="w-4 h-4" /></Button>
                          </div>
                      </div>
                    
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
            <p className="font-semibold text-center mb-4 pt-1">{file.isGroup ? (file.imageFiles.length > 1 ? `Image Collage (${file.imageFiles.length} photos)` : file.imageFiles[0]?.originalFile.name || 'Image') : file.originalFile?.name}</p>

            {file.isImageFile ? (
              // IMPROVED IMAGE LAYOUT
              <div className="space-y-6">
                {/* Layout Selection - Visual Grid Cards */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <Label className="font-semibold">Layout</Label>
                      <p className="text-xs text-muted-foreground">How many photos per page</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    {layoutOptions.map(opt => {
                      const isSelected = file.imageLayout.type === opt.value;
                      const cols = file.orientation === 'portrait' ? opt.grid[0] : opt.grid[1];
                      const rows = file.orientation === 'portrait' ? opt.grid[1] : opt.grid[0];
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { updateFileDetails(file.id, { imageLayout: { ...file.imageLayout, type: opt.value } }); setPreviewPages(prev => ({ ...prev, [file.id]: 0 })); }}
                          className={cn(
                            "border-2 rounded-xl p-3 text-center cursor-pointer transition-all",
                            isSelected ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                          )}
                        >
                          <div
                            className="grid gap-0.5 mx-auto mb-2"
                            style={{
                              gridTemplateColumns: `repeat(${Math.min(cols, 4)}, 1fr)`,
                              gridTemplateRows: `repeat(${Math.min(rows, 4)}, 1fr)`,
                              width: 56,
                              height: 68,
                            }}
                          >
                            {Array.from({ length: Math.min(opt.photosPerPage, 16) }).map((_, i) => (
                              <div key={i} className={cn("rounded-sm", isSelected ? "bg-primary/30" : "bg-gray-300")} />
                            ))}
                          </div>
                          <div className="text-sm font-medium leading-tight">{opt.label}</div>
                          <div className="text-[10px] text-muted-foreground leading-tight">{opt.subtitle}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Orientation + Fit in a row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Orientation */}
                  <div>
                    <Label className="font-semibold">Orientation</Label>
                    <p className="text-xs text-muted-foreground mb-2">Page orientation for this file</p>
                    <RadioGroup value={file.orientation} onValueChange={(v) => { updateFileDetails(file.id, { orientation: v as any }); setPreviewPages(prev => ({ ...prev, [file.id]: 0 })); }} className="grid grid-cols-3 gap-2">
                      <Label htmlFor={`auto-${file.id}`} className={cn("border-2 rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all", file.orientation === 'auto' ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-gray-200 bg-white hover:border-gray-300')}>
                        <RadioGroupItem value="auto" id={`auto-${file.id}`} className="sr-only" />
                        <Settings2 className="w-5 h-5 text-muted-foreground" />
                        <span className="text-sm font-medium">Auto</span>
                        <span className="text-[10px] text-muted-foreground leading-tight">Match photo</span>
                      </Label>
                      <Label htmlFor={`portrait-${file.id}`} className={cn("border-2 rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all", file.orientation === 'portrait' ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-gray-200 bg-white hover:border-gray-300')}>
                        <RadioGroupItem value="portrait" id={`portrait-${file.id}`} className="sr-only" />
                        <div className="w-7 h-10 border-2 border-current rounded" />
                        <span className="text-sm font-medium">Portrait</span>
                        <span className="text-[10px] text-muted-foreground leading-tight">Tall page</span>
                      </Label>
                      <Label htmlFor={`landscape-${file.id}`} className={cn("border-2 rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all", file.orientation === 'landscape' ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-gray-200 bg-white hover:border-gray-300')}>
                        <RadioGroupItem value="landscape" id={`landscape-${file.id}`} className="sr-only" />
                        <div className="w-10 h-7 border-2 border-current rounded" />
                        <span className="text-sm font-medium">Landscape</span>
                        <span className="text-[10px] text-muted-foreground leading-tight">Wide page</span>
                      </Label>
                    </RadioGroup>
                  </div>

                  {/* Fit Mode */}
                  <div>
                    <Label className="font-semibold">Image Fit</Label>
                    <p className="text-xs text-muted-foreground mb-2">How photos fill their frame</p>
                    <RadioGroup value={file.imageLayout.fit} onValueChange={(v) => updateFileDetails(file.id, { imageLayout: { ...file.imageLayout, fit: v as any } })} className="grid grid-cols-2 gap-2">
                      <Label htmlFor={`contain-${file.id}`} className={cn("border-2 rounded-lg p-3 flex items-start gap-3 cursor-pointer transition-all h-full", file.imageLayout.fit === 'contain' ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-gray-200 bg-white hover:border-gray-300')}>
                        <RadioGroupItem value="contain" id={`contain-${file.id}`} className="sr-only" />
                        <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center flex-shrink-0 mt-0.5">
                          <div className="w-6 h-6 bg-gray-400 rounded-sm" />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-medium">Fit</div>
                          <div className="text-[10px] text-muted-foreground leading-tight">Whole photo visible, may have white borders</div>
                        </div>
                      </Label>
                      <Label htmlFor={`cover-${file.id}`} className={cn("border-2 rounded-lg p-3 flex items-start gap-3 cursor-pointer transition-all h-full", file.imageLayout.fit === 'cover' ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-gray-200 bg-white hover:border-gray-300')}>
                        <RadioGroupItem value="cover" id={`cover-${file.id}`} className="sr-only" />
                        <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center flex-shrink-0 mt-0.5 overflow-hidden">
                          <div className="w-8 h-8 bg-gray-400 rounded-sm flex-shrink-0" />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-medium">Cover</div>
                          <div className="text-[10px] text-muted-foreground leading-tight">Fills the frame, edges may be cropped</div>
                        </div>
                      </Label>
                    </RadioGroup>
                  </div>
                </div>

                {/* Print Preview */}
                {(() => {
                  const layout = layoutOptions.find(l => l.value === file.imageLayout.type)!;
                  const cols = file.orientation === 'portrait' ? layout.grid[0] : layout.grid[1];
                  const rows = file.orientation === 'portrait' ? layout.grid[1] : layout.grid[0];
                  const totalPages = Math.ceil(file.imageFiles.length / layout.photosPerPage);
                  const currentPage = previewPages[file.id] || 0;
                  const startIdx = currentPage * layout.photosPerPage;
                  const pageImages = file.imageFiles.slice(startIdx, startIdx + layout.photosPerPage);
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <Label className="font-semibold">Print Preview</Label>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {file.imageFiles.length} photo{file.imageFiles.length !== 1 ? 's' : ''} &middot; {totalPages} page{totalPages !== 1 ? 's' : ''} &middot; {file.copies} cop{file.copies > 1 ? 'ies' : 'y'}
                        </span>
                      </div>
                      <div className="bg-gray-100 rounded-xl p-4 md:p-6 overflow-auto">
                        <div className="flex flex-col items-center gap-4">
                          <div className={cn(
                            "bg-white shadow-lg rounded-md relative flex-shrink-0",
                            file.orientation === 'portrait' ? "w-full max-w-[280px] aspect-[210/297]" : "w-full max-w-[360px] aspect-[297/210]"
                          )}>
                            <div className="absolute inset-[8%]">
                              <div
                                className="grid h-full w-full gap-px"
                                style={{
                                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                                  gridTemplateRows: `repeat(${rows}, 1fr)`,
                                }}
                              >
                                {Array.from({ length: Math.min(pageImages.length, layout.photosPerPage) }).map((_, i) => {
                                  const img = pageImages[i];
                                  return (
                                    <div key={i} className="bg-gray-50 flex items-center justify-center overflow-hidden relative rounded-sm border border-gray-100">
                                      {img?.previewUrl ? (
                                        <Image
                                          src={img.previewUrl}
                                          alt=""
                                          fill
                                          className={file.imageLayout.fit === 'contain' ? 'object-contain p-0.5' : 'object-cover'}
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                          {totalPages > 1 && (
                            <div className="flex items-center gap-3">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 bg-white"
                                disabled={currentPage === 0}
                                onClick={() => setPreviewPages(prev => ({ ...prev, [file.id]: currentPage - 1 }))}
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </Button>
                              <span className="text-sm font-medium min-w-[80px] text-center tabular-nums">
                                {currentPage + 1} / {totalPages}
                              </span>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 bg-white"
                                disabled={currentPage >= totalPages - 1}
                                onClick={() => setPreviewPages(prev => ({ ...prev, [file.id]: currentPage + 1 }))}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
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
                        const fileName = file.isGroup ? `Image Collage (${file.imageFiles.length} photos)` : file.originalFile!.name;
                        return (
                        <div key={file.id} className={cn("p-3 flex flex-col md:flex-row justify-between items-start md:items-center text-sm gap-2", index % 2 === 0 ? "bg-blue-50/50" : "bg-yellow-50/50")}>
                            <div className='flex-1'>
                                <p className="font-medium truncate pr-4"><span className="font-bold mr-2">{index+1}.</span>{fileName}</p>
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
                                            {file.isGroup ? `Image Collage (${file.imageFiles?.length} photos)` : file.originalFileName}
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
