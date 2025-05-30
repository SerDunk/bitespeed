export interface IdentifyRequest {
  email?: string;
  phoneNumber?: number;
}

export interface IdentifyResponse {
  contact: {
    primaryContactId: number;
    emails: string[];
    phoneNumbers: number[];
    secondaryContactIds: number[];
  };
}
