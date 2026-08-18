export interface ISetWorkAreaInput {
  date?: string; 
  zoneName: string;
  postalCodes?: string[];
}

export interface IWorkAreaResponse {
  id: string;
  traderId: string;
  date: string;
  zoneName: string;
  postalCodes: string[];
  createdAt: Date;
  updatedAt: Date;
}
