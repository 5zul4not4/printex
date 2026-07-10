export type OrderType = 'print' | 'edit' | 'xerox' | 'test-page' | 'page-count-request';

export interface ImageLayout {
  type: 'full-page' | '2-up' | '4-up' | '9-up' | 'contact-sheet';
  photosPerPage: number;
  fit: 'contain' | 'cover';
}

export interface FileInJob {
  isGroup: boolean;
  imageFiles?: ImageFile[];

  fileName: string;
  originalFileName: string;
  streamSessionId: string;
  isWordFile: boolean;
  isImageFile: boolean;
  pageCount: number;
  pageRange: string;
  copies: number;
  printType: 'bw' | 'color';
  paperSize: 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
  orientation: 'portrait' | 'landscape' | 'auto';
  duplex: 'one-sided' | 'duplex-long-edge' | 'duplex-short-edge';
  imageLayout?: ImageLayout;
}

export interface ImageFile {
  originalFileName: string;
  uniqueFileName: string;
  streamSessionId: string;
}

export interface StreamSession {
  id: string;
  status: 'pending' | 'connecting' | 'streaming' | 'completed' | 'error';
  jobId?: string;
  progress: number;
  errorMessage?: string;
  browserSdp?: string;
  connectorSdp?: string;
  browserIce?: string[];
  connectorIce?: string[];
  method?: 'http' | 'webrtc' | 'relay';
  fileName: string;
  fileSize: number;
  createdAt: any;
}

export interface PrintJob {
  id: string;
  orderType: OrderType;
  status: 'pending-payment' | 'pending' | 'uploading' | 'ready' | 'printing' | 'completed' | 'error' | 'page-count-request' | 'page-count-completed' | 'reprint' | 'reprint-completed' | 'cancelled';
  createdAt: any;
  printerId: string;
  name: string;
  cost: number;

  username: string;
  phoneNumber?: string;
  orderId: string;
  binding?: 'none' | 'spiral' | 'soft';
  files: FileInJob[];
  isReprint?: boolean;

  paymentId?: string;
  razorpayOrderId?: string;
  paymentMethod?: string;
  paymentTime?: any;

  fileName?: string;
  pageCount?: number;
  streamSessionId?: string;
  error_message?: string;
  printedAt?: any;
}

export interface Printer {
    id: string;
    name: string;
    status: 'online' | 'offline';
    lastSeen: any;
    capabilities: ('bw' | 'color' | 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'duplex' | 'single-sided')[];
    queueLength: number;
    estimatedWaitTime: number;
    connectorHost?: string;
    connectorPort?: number;
}

export interface PaperSizes {
  A0: boolean;
  A1: boolean;
  A2: boolean;
  A3: boolean;
  A4: boolean;
}

export interface Pricing {
  bwA4First10Pages: number;
  bwA4First10Price: number;
  bwA4After10Price: number;
  coverPageFee: number;
  colorA4Price: number;
  bwA3Price: number;
  colorA3Price: number;
  bwA2Price: number;
  bwA1Price: number;
  bwA0Price: number;
  colorA2Price: number;
  colorA1Price: number;
  colorA0Price: number;
  spiralBindingFee: number;
  softBindingFee: number;
  editFee: number;
}
