export type UserType = 'customer' | 'adjuster';

export interface User {
  id: string;
  email: string;
  name: string;
  userType: UserType;
  phone?: string;
  profileImage?: string;
  createdAt: string;
}

export interface Adjuster extends User {
  licenseNumber: string;
  specialties: string[];
  rating: number;
  reviewCount: number;
  resolvedCases: number;
  bio: string;
  fee?: string;
}

export interface Case {
  id: string;
  customerId: string;
  title: string;
  accidentType: string;
  insuranceCompany: string;
  description: string;
  images: string[];
  status: 'pending' | 'reviewing' | 'in_progress' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  caseId: string;
  adjusterId: string;
  adjuster?: Adjuster;
  estimatedAmount: string;
  description: string;
  timeline: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface Message {
  id: string;
  chatRoomId: string;
  senderId: string;
  content: string;
  attachments?: Attachment[];
  createdAt: string;
  read: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'document' | 'pdf';
  size: number;
}

export interface ChatRoom {
  id: string;
  caseId: string;
  customerId: string;
  adjusterId: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
}

export interface ResolvedCase {
  id: string;
  title: string;
  category: string;
  originalAmount: string;
  resolvedAmount: string;
  description: string;
  adjusterName: string;
  resolvedAt: string;
}
