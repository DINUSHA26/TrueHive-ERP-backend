import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "@/infrastructure/database/prisma.service";

export interface CreateEmployeeDto {
  empId?: string;
  name: string;
  phone?: string;
  email?: string;
  department?: string;
  designation?: string;
  salaryType?: "MONTHLY" | "DAILY" | "HOURLY";
  basicSalary: number;
  mealCost?: number;
  epfEtf?: number;
  status?: "ACTIVE" | "INACTIVE" | "TERMINATED" | "PROBATION";
  joinedDate?: string;
}

export interface UpdateEmployeeDto extends Partial<CreateEmployeeDto> {}

export interface BatchAttendanceDto {
  date: string; // YYYY-MM-DD
  records: {
    employeeId: string;
    status: "PRESENT" | "HALF_DAY" | "ABSENT" | "LEAVE";
    notes?: string;
  }[];
}

export interface CreateAdvanceDto {
  employeeId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  notes?: string;
}

export interface UpdatePayrollItemDto {
  serviceCharges?: number;
  bonus?: number;
  mealCost?: number;
  epfEtf?: number;
  status?: "OPEN" | "APPROVED" | "PAID";
}

@Injectable()
export class HrmService {
  private readonly logger = new Logger(HrmService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // 1. SEED DEFAULT EMPLOYEES (IF EMPTY)
  // ==========================================
  async seedInitialEmployeesIfEmpty() {
    const count = await this.prisma.employee.count();
    if (count === 0) {
      await this.prisma.employee.createMany({
        data: [
          {
            empId: "001",
            name: "Manidu Dinusha",
            phone: "07957612348",
            salaryType: "MONTHLY",
            basicSalary: 12000,
            mealCost: 0,
            epfEtf: 0,
            status: "ACTIVE",
            department: "Executive Management",
            designation: "Managing Director",
            joinedDate: new Date("2026-11-19"),
          },
          {
            empId: "002",
            name: "kasun",
            phone: "07845193",
            salaryType: "MONTHLY",
            basicSalary: 50000,
            mealCost: 0,
            epfEtf: 0,
            status: "ACTIVE",
            department: "Operations",
            designation: "Operations Lead",
            joinedDate: new Date("2026-11-19"),
          },
        ],
      });
      this.logger.log("Seeded initial employees (001 - Manidu Dinusha, 002 - kasun)");
    }
  }

  // ==========================================
  // 2. EMPLOYEE MASTER DIRECTORY
  // ==========================================
  async getEmployees(search?: string, status?: string) {
    await this.seedInitialEmployeesIfEmpty();

    const where: any = {};
    if (status && status !== "ALL") {
      where.status = status;
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { empId: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

    const employees = await this.prisma.employee.findMany({
      where,
      orderBy: { empId: "asc" },
      include: {
        _count: {
          select: {
            attendances: true,
            advances: true,
          },
        },
      },
    });

    return {
      success: true,
      employees,
      total: employees.length,
    };
  }

  async getEmployeeById(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        attendances: { orderBy: { date: "desc" }, take: 30 },
        advances: { orderBy: { advanceDate: "desc" }, take: 20 },
      },
    });
    if (!employee) throw new NotFoundException(`Employee ${id} not found`);
    return { success: true, employee };
  }

  async createEmployee(dto: CreateEmployeeDto) {
    let empId = dto.empId?.trim();
    if (!empId) {
      // Auto generate next code e.g. "003"
      const last = await this.prisma.employee.findFirst({
        orderBy: { empId: "desc" },
      });
      const num = last && !isNaN(Number(last.empId)) ? Number(last.empId) + 1 : 1;
      empId = String(num).padStart(3, "0");
    }

    // Check duplicate empId
    const existing = await this.prisma.employee.findUnique({ where: { empId } });
    if (existing) {
      throw new BadRequestException(`Employee ID '${empId}' is already in use`);
    }

    const employee = await this.prisma.employee.create({
      data: {
        empId,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        department: dto.department?.trim() || "Operations",
        designation: dto.designation?.trim() || "Staff",
        salaryType: dto.salaryType || "MONTHLY",
        basicSalary: Number(dto.basicSalary) || 0,
        mealCost: Number(dto.mealCost) || 0,
        epfEtf: Number(dto.epfEtf) || 0,
        status: dto.status || "ACTIVE",
        joinedDate: dto.joinedDate ? new Date(dto.joinedDate) : new Date(),
      },
    });

    return { success: true, employee };
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto) {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Employee not found");

    if (dto.empId && dto.empId !== existing.empId) {
      const duplicate = await this.prisma.employee.findUnique({ where: { empId: dto.empId } });
      if (duplicate) throw new BadRequestException(`Employee ID '${dto.empId}' already exists`);
    }

    const employee = await this.prisma.employee.update({
      where: { id },
      data: {
        ...(dto.empId && { empId: dto.empId }),
        ...(dto.name && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.department !== undefined && { department: dto.department }),
        ...(dto.designation !== undefined && { designation: dto.designation }),
        ...(dto.salaryType && { salaryType: dto.salaryType }),
        ...(dto.basicSalary !== undefined && { basicSalary: Number(dto.basicSalary) }),
        ...(dto.mealCost !== undefined && { mealCost: Number(dto.mealCost) }),
        ...(dto.epfEtf !== undefined && { epfEtf: Number(dto.epfEtf) }),
        ...(dto.status && { status: dto.status }),
        ...(dto.joinedDate && { joinedDate: new Date(dto.joinedDate) }),
      },
    });

    return { success: true, employee };
  }

  async deleteEmployee(id: string) {
    const existing = await this.prisma.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Employee not found");

    await this.prisma.employee.delete({ where: { id } });
    return { success: true, message: "Employee removed successfully" };
  }

  // ==========================================
  // 3. DAILY ATTENDANCE & MONTHLY REPORT
  // ==========================================
  async getDailyAttendance(dateString?: string) {
    await this.seedInitialEmployeesIfEmpty();

    const targetDate = dateString || new Date().toISOString().split("T")[0];
    const employees = await this.prisma.employee.findMany({
      where: { status: "ACTIVE" },
      orderBy: { empId: "asc" },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { date: targetDate },
    });

    const recordMap = new Map<string, any>();
    records.forEach((r) => recordMap.set(r.employeeId, r));

    const attendanceList = employees.map((emp) => {
      const rec = recordMap.get(emp.id);
      return {
        id: rec ? rec.id : `draft-${emp.id}`,
        employeeId: emp.id,
        empId: emp.empId,
        employeeName: emp.name,
        date: targetDate,
        status: rec ? rec.status : "PRESENT",
        notes: rec?.notes || "",
        isSaved: Boolean(rec),
      };
    });

    return {
      success: true,
      date: targetDate,
      attendance: attendanceList,
    };
  }

  async saveBatchAttendance(dto: BatchAttendanceDto) {
    const targetDate = dto.date;
    const upsertPromises = dto.records.map((r) => {
      let payableUnits = 1.0;
      if (r.status === "HALF_DAY") payableUnits = 0.5;
      else if (r.status === "ABSENT") payableUnits = 0.0;
      else if (r.status === "LEAVE") payableUnits = 1.0;

      return this.prisma.attendanceRecord.upsert({
        where: {
          employeeId_date: {
            employeeId: r.employeeId,
            date: targetDate,
          },
        },
        create: {
          employeeId: r.employeeId,
          date: targetDate,
          status: r.status,
          payableUnits,
          notes: r.notes || null,
        },
        update: {
          status: r.status,
          payableUnits,
          notes: r.notes || null,
        },
      });
    });

    await Promise.all(upsertPromises);
    return { success: true, message: "Daily attendance saved successfully", date: targetDate };
  }

  async getMonthlyAttendanceReport(month: number, year: number) {
    await this.seedInitialEmployeesIfEmpty();

    const monthStr = String(month).padStart(2, "0");
    const prefix = `${year}-${monthStr}`;

    const employees = await this.prisma.employee.findMany({
      where: { status: "ACTIVE" },
      orderBy: { empId: "asc" },
    });

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        date: { startsWith: prefix },
      },
    });

    const report = employees.map((emp) => {
      const empRecords = records.filter((r) => r.employeeId === emp.id);
      let presentDays = 0;
      let halfDays = 0;
      let leaves = 0;
      let absents = 0;
      let totalUnits = 0;

      empRecords.forEach((r) => {
        if (r.status === "PRESENT") {
          presentDays += 1;
          totalUnits += 1.0;
        } else if (r.status === "HALF_DAY") {
          halfDays += 1;
          totalUnits += 0.5;
        } else if (r.status === "LEAVE") {
          leaves += 1;
          totalUnits += 1.0;
        } else if (r.status === "ABSENT") {
          absents += 1;
        }
      });

      return {
        employeeId: emp.id,
        empId: emp.empId,
        employeeName: emp.name,
        presentDays,
        halfDays,
        leaves,
        absents,
        totalWorkingDays: totalUnits,
      };
    });

    return {
      success: true,
      month,
      year,
      monthName: new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" }),
      report,
    };
  }

  // ==========================================
  // 4. SALARY ADVANCES LOG
  // ==========================================
  async getAdvances(monthString?: string) {
    const where: any = {};
    if (monthString && monthString !== "ALL") {
      where.monthString = monthString;
    }

    const advances = await this.prisma.salaryAdvance.findMany({
      where,
      orderBy: { advanceDate: "desc" },
      include: {
        employee: {
          select: {
            id: true,
            empId: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    const formatted = advances.map((adv) => ({
      id: adv.id,
      date: adv.dateString || adv.advanceDate.toISOString().split("T")[0],
      empId: adv.employee.empId,
      employeeId: adv.employee.id,
      employeeName: adv.employee.name,
      advanceAmount: adv.amount,
      note: adv.notes || "",
      status: adv.status,
    }));

    return { success: true, advances: formatted };
  }

  async logSalaryAdvance(dto: CreateAdvanceDto) {
    if (dto.amount <= 0) {
      throw new BadRequestException("Advance amount must be greater than 0");
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException("Employee not found");

    const dateStr = dto.date || new Date().toISOString().split("T")[0];
    const monthStr = dateStr.slice(0, 7); // YYYY-MM

    const advance = await this.prisma.salaryAdvance.create({
      data: {
        employeeId: employee.id,
        amount: Number(dto.amount),
        advanceDate: new Date(dateStr),
        dateString: dateStr,
        monthString: monthStr,
        notes: dto.notes?.trim() || null,
        status: "PAID",
      },
      include: { employee: true },
    });

    // Auto-record Cash Flow Transaction (Expense outflow)
    try {
      await this.prisma.cashFlowTransaction.create({
        data: {
          transactionCode: `ADV-${Math.floor(100000 + Math.random() * 900000)}`,
          amount: Number(dto.amount),
          type: "EXPENSE",
          category: "SALARY_ADVANCE",
          description: `Salary Advance Disbursed for ${employee.name} (${employee.empId})`,
          paymentMethod: "CASH",
        },
      });
    } catch (e) {
      this.logger.warn(`Could not create CashFlow entry for advance: ${e.message}`);
    }

    return { success: true, advance };
  }

  async deleteSalaryAdvance(id: string) {
    const existing = await this.prisma.salaryAdvance.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Advance not found");

    await this.prisma.salaryAdvance.delete({ where: { id } });
    return { success: true, message: "Salary advance deleted successfully" };
  }

  // ==========================================
  // 5. MONTHLY SALARY SHEET & STATUTORY ENGINE
  // ==========================================
  async getMonthlySalarySheet(month: number, year: number) {
    await this.seedInitialEmployeesIfEmpty();

    const monthStr = String(month).padStart(2, "0");
    const monthKey = `${year}-${monthStr}`;

    const employees = await this.prisma.employee.findMany({
      where: { status: "ACTIVE" },
      orderBy: { empId: "asc" },
    });

    // Fetch attendance for working days computation
    const attendanceRecords = await this.prisma.attendanceRecord.findMany({
      where: { date: { startsWith: monthKey } },
    });

    // Fetch advances logged for this month
    const advances = await this.prisma.salaryAdvance.findMany({
      where: { monthString: monthKey },
    });

    // Fetch any saved payroll records
    const savedRecords = await this.prisma.payrollRecord.findMany({
      where: { monthKey },
    });
    const savedMap = new Map<string, any>();
    savedRecords.forEach((sr) => savedMap.set(sr.employeeId, sr));

    let totalBaseSalaries = 0;
    let totalAdvancesAll = 0;
    let totalNetSalaries = 0;

    const sheet = employees.map((emp) => {
      const saved = savedMap.get(emp.id);

      // 1. Calculate working days
      const empAttendance = attendanceRecords.filter((a) => a.employeeId === emp.id);
      let calculatedWorkingDays = 0;
      empAttendance.forEach((a) => {
        calculatedWorkingDays += a.payableUnits;
      });

      // 2. Base salary computation
      let baseSalary = emp.basicSalary;
      if (emp.salaryType === "DAILY") {
        baseSalary = emp.basicSalary * calculatedWorkingDays;
      }

      // 3. Advances
      const empAdvances = advances
        .filter((a) => a.employeeId === emp.id)
        .reduce((sum, a) => sum + a.amount, 0);

      const serviceCharges = saved?.serviceCharges ?? 0;
      const bonus = saved?.bonus ?? 0;
      const mealCost = saved?.mealCost ?? emp.mealCost ?? 0;
      const epfEtf = saved?.epfEtf ?? emp.epfEtf ?? 0;
      const status = saved?.status ?? "OPEN";

      // 4. Total Monthly Salary: Base + Service + Bonus - Meal - EPF - Advances
      const totalSalaryForMonth = Math.max(
        0,
        baseSalary + serviceCharges + bonus - mealCost - epfEtf - empAdvances
      );

      totalBaseSalaries += baseSalary;
      totalAdvancesAll += empAdvances;
      totalNetSalaries += totalSalaryForMonth;

      return {
        id: saved?.id || `draft-${emp.id}-${monthKey}`,
        employeeId: emp.id,
        empId: emp.empId,
        employeeName: emp.name,
        phone: emp.phone,
        type: emp.salaryType === "MONTHLY" ? "Monthly" : "Daily",
        rate: emp.basicSalary,
        workingDays: calculatedWorkingDays,
        baseSalary,
        serviceCharges,
        bonus,
        mealCost,
        epfEtf,
        advanced: empAdvances,
        totalSalaryForMonth,
        status,
      };
    });

    return {
      success: true,
      month,
      year,
      monthName: new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" }),
      totals: {
        totalBaseSalaries,
        totalAdvances: totalAdvancesAll,
        totalNetSalaries,
        totalEmployees: sheet.length,
      },
      sheet,
    };
  }

  async updatePayrollStatus(dto: {
    employeeId: string;
    month: number;
    year: number;
    status: "OPEN" | "APPROVED" | "PAID";
    paymentMethod?: string;
  }) {
    const monthStr = String(dto.month).padStart(2, "0");
    const monthKey = `${dto.year}-${monthStr}`;

    const sheetData = await this.getMonthlySalarySheet(dto.month, dto.year);
    const empItem = sheetData.sheet.find((s) => s.employeeId === dto.employeeId);
    if (!empItem) throw new NotFoundException("Employee not found in payroll sheet");

    const record = await this.prisma.payrollRecord.upsert({
      where: {
        employeeId_monthKey: {
          employeeId: dto.employeeId,
          monthKey,
        },
      },
      create: {
        employeeId: dto.employeeId,
        month: dto.month,
        year: dto.year,
        monthKey,
        salaryType: empItem.type === "Monthly" ? "MONTHLY" : "DAILY",
        rate: empItem.rate,
        workingDays: empItem.workingDays,
        baseSalary: empItem.baseSalary,
        serviceCharges: empItem.serviceCharges,
        bonus: empItem.bonus,
        mealCost: empItem.mealCost,
        epfEtf: empItem.epfEtf,
        advances: empItem.advanced,
        totalSalary: empItem.totalSalaryForMonth,
        status: dto.status,
        paidAt: dto.status === "PAID" ? new Date() : null,
        paymentMethod: dto.paymentMethod || "BANK_TRANSFER",
      },
      update: {
        status: dto.status,
        paidAt: dto.status === "PAID" ? new Date() : null,
        paymentMethod: dto.paymentMethod || "BANK_TRANSFER",
      },
    });

    // If marked as PAID, also log Cash Flow Transaction
    if (dto.status === "PAID") {
      try {
        await this.prisma.cashFlowTransaction.create({
          data: {
            transactionCode: `PAY-${Math.floor(100000 + Math.random() * 900000)}`,
            amount: empItem.totalSalaryForMonth,
            type: "EXPENSE",
            category: "PAYROLL_SALARY",
            description: `Salary Payment for ${empItem.employeeName} (${empItem.empId}) - ${monthKey}`,
            paymentMethod: dto.paymentMethod || "BANK_TRANSFER",
          },
        });
      } catch (e) {
        this.logger.warn(`Could not create CashFlow entry for salary: ${e.message}`);
      }
    }

    return { success: true, record };
  }
}
