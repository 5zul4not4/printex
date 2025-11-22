

export type OrderType = 'print' | 'edit' | 'xerox' | 'test-page' | 'page-count-request';

export interface ImageLayout {
  type: 'full-page' | '2-up' | '4-up' | '9-up' | 'contact-sheet';
  photosPerPage: number;
  fit: 'contain' | 'cover';
}

export interface FileInJob {
  fileName: string; // The *unique* file name used for upload
  originalFileName: string; // The original user-facing file name
  googleDriveFileId: string; // The final, real GDrive ID
  isWordFile: boolean;
  isImageFile: boolean;
  pageCount: number;
  pageRange: string;
  copies: number;
  printType: 'bw' | 'color';
  paperSize: 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
  orientation: 'portrait' | 'landscape';
  duplex: 'one-sided' | 'duplex-long-edge' | 'duplex-short-edge';
  imageLayout?: ImageLayout;
}

export interface PrintJob {
  id: string;
  orderType: OrderType;
  status: 'pending-payment' | 'pending' | 'uploading' | 'ready' | 'printing' | 'completed' | 'error' | 'page-count-request' | 'page-count-completed' | 'reprint' | 'reprint-completed';
  createdAt: any; // Firestore Timestamp
  printerId: string;
  name: string; // Printer Name
  cost: number;
  
  // New Order-level properties
  username: string;
  phoneNumber?: string;
  orderId: string; // A user-facing ID for the whole order
  binding?: 'none' | 'spiral' | 'soft';
  files: FileInJob[];
  isReprint?: boolean;

  // Payment fields
  paymentId?: string;
  razorpayOrderId?: string;
  paymentMethod?: string;
  paymentTime?: any; // Firestore Timestamp
  
  // Optional/legacy fields for specific job types
  fileName?: string; // For test-page or single-file page-count-request
  googleDriveFileId?: string; // For single-file page-count-request result
  pageCount?: number; // For single-file page-count-request result
  error_message?: string;
  printedAt?: any; // Firestore Timestamp
}


export interface Printer {
    id: string;
    name: string;
    status: 'online' | 'offline';
    lastSeen: any; // Firestore Timestamp
    capabilities: ('bw' | 'color' | 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'duplex' | 'single-sided')[];
    queueLength: number;
    estimatedWaitTime: number; // in seconds
}

export interface PaperSizes {
  A0: boolean;
  A1: boolean;
  A2: boolean;
  A3: boolean;
  A4: boolean;
}

export interface Pricing {
  // B/W Xerox (A4)
  bwA4First10Pages: number;
  bwA4First10Price: number;
  bwA4After10Price: number;
  coverPageFee: number;

  // Color (A4)
  colorA4Price: number;
  
  // A3 Prices
  bwA3Price: number;
  colorA3Price: number;

  // Large Format B/W (A2, A1, A0)
  bwA2Price: number;
  bwA1Price: number;
  bwA0Price: number;

  // Large Format Color (A2, A1, A0)
  colorA2Price: number;
  colorA1Price: number;
  colorA0Price: number;

  // Binding
  spiralBindingFee: number;
  softBindingFee: number;

  // Edit Fee
  editFee: number;
}
