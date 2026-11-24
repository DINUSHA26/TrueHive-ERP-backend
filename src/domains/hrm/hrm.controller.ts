import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import {
  HrmService,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  BatchAttendanceDto,
  CreateAdvanceDto,
} from "./hrm.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("HRM")
@Controller("hrm")
export class HrmController {
  constructor(private readonly hrmService: HrmService) {}

  // ==========================================
  // EMPLOYEES CRUD
  // ==========================================
  @Public()
  @Get("employees")
  @ApiOperation({ summary: "List all employees with search and status filter" })
  async getEmployees(
    @Query("search") search?: string,
    @Query("status") status?: string
  ) {
    return this.hrmService.getEmployees(search, status);
  }

  @Public()
  @Get("employees/:id")
  @ApiOperation({ summary: "Get single employee details with attendance and advances" })
  async getEmployeeById(@Param("id") id: string) {
    return this.hrmService.getEmployeeById(id);
  }

  @Public()
  @Post("employees")
  @ApiOperation({ summary: "Register new employee" })
  async createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.hrmService.createEmployee(dto);
  }

  @Public()
  @Put("employees/:id")
  @ApiOperation({ summary: "Update existing employee details" })
  async updateEmployee(
    @Param("id") id: string,
    @Body() dto: UpdateEmployeeDto
  ) {
    return this.hrmService.updateEmployee(id, dto);
  }

  @Public()
  @Delete("employees/:id")
  @ApiOperation({ summary: "Delete employee" })
  async deleteEmployee(@Param("id") id: string) {
    return this.hrmService.deleteEmployee(id);
  }

  // ==========================================
  // ATTENDANCE
  // ==========================================
  @Public()
  @Get("attendance")
  @ApiOperation({ summary: "Get daily attendance records by date" })
  async getDailyAttendance(@Query("date") date?: string) {
    return this.hrmService.getDailyAttendance(date);
  }

  @Public()
  @Post("attendance/batch")
  @ApiOperation({ summary: "Save or update batch daily attendance" })
  async saveBatchAttendance(@Body() dto: BatchAttendanceDto) {
    return this.hrmService.saveBatchAttendance(dto);
  }

  @Public()
  @Get("attendance/monthly-report")
  @ApiOperation({ summary: "Get monthly attendance summary report" })
  async getMonthlyAttendanceReport(
    @Query("month") month?: string,
    @Query("year") year?: string
  ) {
    const m = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.hrmService.getMonthlyAttendanceReport(m, y);
  }

  // ==========================================
  // SALARY ADVANCES
  // ==========================================
  @Public()
  @Get("advances")
  @ApiOperation({ summary: "Get salary advances log" })
  async getAdvances(@Query("month") month?: string) {
    return this.hrmService.getAdvances(month);
  }

  @Public()
  @Post("advances")
  @ApiOperation({ summary: "Log new salary advance and disburse" })
  async logSalaryAdvance(@Body() dto: CreateAdvanceDto) {
    return this.hrmService.logSalaryAdvance(dto);
  }

  @Public()
  @Delete("advances/:id")
  @ApiOperation({ summary: "Delete salary advance entry" })
  async deleteSalaryAdvance(@Param("id") id: string) {
    return this.hrmService.deleteSalaryAdvance(id);
  }

  // ==========================================
  // MONTHLY SALARY SHEET & PAYROLL
  // ==========================================
  @Public()
  @Get("payroll/sheet")
  @ApiOperation({ summary: "Get monthly salary sheet with advances and attendance deductions" })
  async getMonthlySalarySheet(
    @Query("month") month?: string,
    @Query("year") year?: string
  ) {
    const m = month ? parseInt(month, 10) : new Date().getMonth() + 1;
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.hrmService.getMonthlySalarySheet(m, y);
  }

  @Public()
  @Post("payroll/sheet/status")
  @ApiOperation({ summary: "Update payroll status (Open, Approved, Paid)" })
  async updatePayrollStatus(
    @Body()
    dto: {
      employeeId: string;
      month: number;
      year: number;
      status: "OPEN" | "APPROVED" | "PAID";
      paymentMethod?: string;
    }
  ) {
    return this.hrmService.updatePayrollStatus(dto);
  }

  @Public()
  @Get("status")
  @ApiOperation({ summary: "HRM Module status" })
  async getStatus() {
    return {
      status: "ACTIVE",
      categories: [
        "Employee Directory & Lifecycle",
        "Daily Attendance & Monthly Reports",
        "Salary Advances & CashFlow Recovery",
        "Monthly Salary Sheet & Payslips",
      ],
    };
  }
}
