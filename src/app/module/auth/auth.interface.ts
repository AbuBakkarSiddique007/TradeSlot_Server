export interface IRegisterTraderInput {
  name: string;
  email: string;
  password: string;
  businessName?: string;
  phone?: string;
}

export interface ILoginTraderInput {
  email: string;
  password: string;
}

export interface ITraderAuthPayload {
  traderId: string;
  email: string;
  businessId: string;
}

export interface IAuthResponse {
  token: string;
  trader: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    businessId: string;
    businessName: string;
    stripeOnboarded: boolean;
    workingHoursStart: string;
    workingHoursEnd: string;
    defaultBufferTime: number;
    defaultJobDuration: number;
  };
}
