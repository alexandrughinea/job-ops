export interface CompanyVitals {
  revenue: number | null;
  profit: number | null;
  employees: number | null;
}

export interface CompanyFounder {
  name: string;
  role: string;
  bio: string | null;
}

export interface CompanyHeadquarters {
  address: string;
  city: string;
  country: string;
}

export interface CompanyLocation {
  locationName: string;
  country: string;
  city: string;
}

export interface CompanyProjectReference {
  projectName: string;
  description: string | null;
  year: number | null;
}

export interface CompanyIntel {
  companyName: string;
  description: string;
  vitals: CompanyVitals;
  founders: CompanyFounder[];
  headquarters: CompanyHeadquarters;
  capital: number | null;
  industry: string;
  locations: CompanyLocation[];
  generalOpinion: string;
  politicalAffiliation: string;
  fundingSources: string[];
  projectReferences: CompanyProjectReference[];
}

export interface CompanyIntelResponse {
  intel: CompanyIntel;
  searchContext: string;
}
