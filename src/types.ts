export type EmployeeInput = {
  id: string;
  name: string;
  category: string;
  monthlySalary: number;
  salaryPerMonth?: number;
  daysWorked: number;
  extraDays: number;
  basicPercent?: number;
  pfOptIn?: boolean;
  esiOptIn?: boolean;
  advance?: number | null;
  otherDeduction: number;
  officialAttendance?: number;
  officialBonus?: number;
  performanceBonus?: number | null;
};

export type SalaryRow = EmployeeInput & {
  perDayWage: number;
  absentDays: number;
  absentDeduction: number;
  basicPercent: number;
  earnedSalary: number;
  basicSalary: number;
  hra: number;
  travelAllowance: number;
  performanceBonus: number;
  pfOptIn: boolean;
  esiOptIn: boolean;
  employeePf: number;
  employerPf: number;
  esi: number;
  employerEsi: number;
  professionalTax: number;
  netPayable: number;
  totalCost: number;
};
