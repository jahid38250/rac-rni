import React, { useState, useMemo } from 'react';
import { 
  Users, CheckCircle2, Award, Calendar, RefreshCw, 
  Search, Filter, Download, Plus, Eye, ChevronRight,
  TrendingUp, Clock, AlertCircle, PauseCircle, Building2,
  Briefcase, ShieldCheck, UserCheck, Layers, FileSpreadsheet,
  X, Check, AlertTriangle, ArrowUpRight
} from 'lucide-react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import * as XLSX from 'xlsx';
import { cn } from './utils';
import { User, Task, Attendance, Role } from './types';
import { toast } from 'sonner';

export interface CBODashboardProps {
  currentUser: User;
  staffList: User[];
  tasks: Task[];
  attendance: Attendance[];
  onOpenNewTaskModal?: (preselectedAssignee?: string) => void;
  onRefreshData?: () => void;
  onUpdateAttendance?: (technicianId: string, status: string) => Promise<void>;
  onSelectTask?: (task: Task) => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WORKFORCE_ROLES: Role[] = [
  'HOD', 'DHOD', 'IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER', 'TECHNICIAN'
];

export const CBODashboard: React.FC<CBODashboardProps> = ({
  currentUser,
  staffList,
  tasks,
  attendance,
  onOpenNewTaskModal,
  onRefreshData,
  onUpdateAttendance,
  onSelectTask
}) => {
  const currentDate = new Date();
  const currentMonthNum = currentDate.getMonth() + 1;
  const currentYearNum = currentDate.getFullYear();

  // Dynamic Month & Year state
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonthNum);
  const [selectedYear, setSelectedYear] = useState<number>(currentYearNum);

  // Category filter: 'ALL' | 'HOD' | 'IN_CHARGE' | 'MODEL_MANAGER' | 'ENGINEER' | 'OFFICER' | 'TECHNICIAN'
  const [selectedRoleCategory, setSelectedRoleCategory] = useState<string>('ALL');

  // Search, department, and performance filter within workforce table
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [performanceFilter, setPerformanceFilter] = useState('ALL');

  // Detail drawer state for a selected employee
  const [selectedStaff, setSelectedStaff] = useState<User | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);

  // Assign task to HOD modal
  const [isAssignHodModalOpen, setIsAssignHodModalOpen] = useState(false);
  const [hodTaskData, setHodTaskData] = useState({
    title: '',
    assignedTo: '',
    model: 'General Work',
    details: '',
    urgency: 'REGULAR' as 'REGULAR' | 'URGENT' | 'MOST_URGENT',
    deadline: '',
    points: 1,
    estimatedDuration: '4 Hours',
    remarks: ''
  });
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  // Dynamic available years based on tasks + current year
  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYearNum, currentYearNum - 1, currentYearNum + 1]);
    tasks.forEach(t => {
      if (t.createdAt) {
        const y = new Date(t.createdAt).getFullYear();
        if (!isNaN(y) && y > 2020 && y < 2035) years.add(y);
      }
      if (t.deadline) {
        const y = new Date(t.deadline).getFullYear();
        if (!isNaN(y) && y > 2020 && y < 2035) years.add(y);
      }
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [tasks, currentYearNum]);

  // Available unique departments
  const availableDepartments = useMemo(() => {
    const depts = new Set<string>();
    staffList.forEach(s => {
      if (s.department && s.department.trim()) depts.add(s.department.trim());
    });
    return Array.from(depts).sort();
  }, [staffList]);

  // Strictly filter tasks by dynamic month and year
  const periodTasks = useMemo(() => {
    return tasks.filter(t => {
      // If month is 0, include entire selectedYear
      if (selectedMonth === 0) {
        const targetYearStr = String(selectedYear);
        if (t.createdAt && t.createdAt.startsWith(targetYearStr)) return true;
        if (t.completedAt && t.completedAt.startsWith(targetYearStr)) return true;
        if (t.deadline && t.deadline.startsWith(targetYearStr)) return true;
        return false;
      }

      const targetPrefix = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
      if (t.createdAt && t.createdAt.startsWith(targetPrefix)) return true;
      if (t.completedAt && t.completedAt.startsWith(targetPrefix)) return true;
      if (t.deadline && t.deadline.startsWith(targetPrefix)) return true;

      // Date object parsing fallback
      if (t.createdAt) {
        const d = new Date(t.createdAt);
        if (!isNaN(d.getTime()) && d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear) return true;
      }
      if (t.completedAt) {
        const d = new Date(t.completedAt);
        if (!isNaN(d.getTime()) && d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear) return true;
      }
      if (t.deadline) {
        const d = new Date(t.deadline);
        if (!isNaN(d.getTime()) && d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear) return true;
      }
      return false;
    });
  }, [tasks, selectedMonth, selectedYear]);

  // Today's date string (YYYY-MM-DD) for attendance mapping
  const todayDateStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Helper: check if person is monitored by CBO
  const isMonitoredByCBO = (person: User): boolean => {
    // CBO oversees all workforce roles below CBO
    return person.role !== 'SUPER_ADMIN' && person.role !== 'CBO';
  };

  // Helper to determine today's attendance status
  const getPersonAttendanceStatus = (empId: string): string => {
    const rec = attendance.find(a => a.technicianId === empId && a.date === todayDateStr);
    if (rec) return rec.status;
    const u = staffList.find(s => s.employeeId === empId);
    if (u?.status === 'ON_LEAVE') return 'LEAVE';
    if (u?.status === 'SHORT_LEAVE') return 'SHORT_LEAVE';
    return 'PRESENT';
  };

  // Helper: Resolve task relations
  const resolveTaskHierarchy = (task: Task) => {
    const creator = staffList.find(s => s.employeeId === task.createdBy || s.id === task.createdBy || s.name === task.createdBy);
    const assigner = staffList.find(s => s.employeeId === task.assignedBy || s.id === task.assignedBy || s.name === task.assignedBy);
    const assignee = staffList.find(s => s.employeeId === task.assignedTo || s.id === task.assignedTo || (s.name && task.assignedTo && s.name.toLowerCase().trim() === task.assignedTo.toLowerCase().trim()));

    let responsibleOfficer: User | undefined;
    if (task.responsibleOfficerId) {
      responsibleOfficer = staffList.find(s => (s.employeeId === task.responsibleOfficerId || s.id === task.responsibleOfficerId) && s.role === 'OFFICER');
    }
    if (!responsibleOfficer) {
      if (creator?.role === 'OFFICER') responsibleOfficer = creator;
      else if (assigner?.role === 'OFFICER') responsibleOfficer = assigner;
      else if (assignee?.role === 'OFFICER') responsibleOfficer = assignee;
      else if (assignee?.role === 'TECHNICIAN' && assignee.supervisorId) {
        responsibleOfficer = staffList.find(s => (s.id === assignee.supervisorId || s.employeeId === assignee.supervisorId) && s.role === 'OFFICER');
      }
    }

    let responsibleEngineer: User | undefined;
    if (creator?.role === 'ENGINEER') responsibleEngineer = creator;
    else if (assigner?.role === 'ENGINEER') responsibleEngineer = assigner;
    else if (assignee?.role === 'ENGINEER') responsibleEngineer = assignee;
    else if (task.approvedBy) {
      const appUser = staffList.find(s => s.employeeId === task.approvedBy || s.id === task.approvedBy);
      if (appUser?.role === 'ENGINEER') responsibleEngineer = appUser;
    } else if (task.recommendedBy) {
      const recUser = staffList.find(s => s.employeeId === task.recommendedBy || s.id === task.recommendedBy);
      if (recUser?.role === 'ENGINEER') responsibleEngineer = recUser;
    } else if (task.concernEngineerId) {
      const concUser = staffList.find(s => s.employeeId === task.concernEngineerId || s.id === task.concernEngineerId);
      if (concUser?.role === 'ENGINEER') responsibleEngineer = concUser;
    }

    return { creator, assigner, assignee, responsibleOfficer, responsibleEngineer };
  };

  // Helper: check if a task belongs to or is managed by an employee
  const isTaskBelongsToPerson = (task: Task, person: User): boolean => {
    const empId = person.employeeId;
    const name = person.name;
    const id = person.id;

    if (task.assignedTo === empId || task.assignedTo === name || task.assignedTo === id || 
        (name && task.assignedTo && task.assignedTo.toLowerCase().trim() === name.toLowerCase().trim())) {
      return true;
    }

    if (task.workType === 'TEAM' && Array.isArray(task.assignedTechnicians)) {
      if (task.assignedTechnicians.some(t => t.employeeId === empId || t.name === name)) return true;
    }

    if (person.role === 'TECHNICIAN') return false;

    if (task.createdBy === empId || task.createdBy === id || task.createdBy === name || task.assignedBy === empId) {
      return true;
    }

    const { creator, assignee, responsibleOfficer, responsibleEngineer } = resolveTaskHierarchy(task);

    if (person.role === 'OFFICER') {
      if (responsibleOfficer?.employeeId === empId) return true;
      if (assignee?.role === 'TECHNICIAN' && (assignee.supervisorId === id || assignee.supervisorId === empId)) return true;
      return false;
    }

    if (person.role === 'ENGINEER') {
      if (responsibleEngineer?.employeeId === empId) return true;
      if (task.approvedBy === empId || task.recommendedBy === empId || task.concernEngineerId === empId) return true;
      return false;
    }

    if (person.role === 'MODEL_MANAGER') {
      if (person.section && task.model && task.model.toLowerCase().trim() === person.section.toLowerCase().trim()) return true;
      if (responsibleEngineer && (person.assignedEngineers || []).includes(responsibleEngineer.employeeId)) return true;
      if (!responsibleEngineer && responsibleOfficer && (responsibleOfficer.assignedEngineers || []).includes(empId)) return true;
      return false;
    }

    if (person.role === 'IN_CHARGE') {
      if (responsibleEngineer && (person.assignedEngineers || []).includes(responsibleEngineer.employeeId)) return true;
      if (!responsibleEngineer && responsibleOfficer && (responsibleOfficer.assignedEngineers || []).includes(empId)) return true;
      if (person.section && ((creator?.section && creator.section === person.section) || (assignee?.section && assignee.section === person.section) || (task.details && task.details.includes(person.section)))) return true;
      if (task.approvedBy === empId || task.recommendedBy === empId) return true;
      return false;
    }

    if (person.role === 'DHOD' || person.role === 'HOD') {
      if (!person.department) return true;
      if (!creator?.department || creator.department === person.department) return true;
      if (!assignee?.department || assignee.department === person.department) return true;
      return true;
    }

    return false;
  };

  // Helper: calculate employee metrics in selected month & year
  const getEmployeeMetrics = (person: User) => {
    const employeeTasks = periodTasks.filter(t => isTaskBelongsToPerson(t, person));
    const totalGiven = employeeTasks.length;
    const completed = employeeTasks.filter(t => (t.status || '').toUpperCase() === 'COMPLETED').length;
    const running = employeeTasks.filter(t => (t.status || '').toUpperCase() === 'RUNNING').length;
    const pending = employeeTasks.filter(t => (t.status || '').toUpperCase() === 'PENDING').length;
    const hold = employeeTasks.filter(t => (t.status || '').toUpperCase() === 'HOLD').length;

    const completionRate = totalGiven > 0 
      ? Math.round((completed / totalGiven) * 100 * 10) / 10 
      : 0;

    let individualPoints = 0;
    let managedPoints = 0;

    employeeTasks.forEach(t => {
      const isCompleted = (t.status || '').toUpperCase() === 'COMPLETED';
      const creator = staffList.find(s => s.employeeId === t.createdBy || s.id === t.createdBy);
      const isApproved = t.requestStatus === 'APPROVED' || 
                         t.requestStatus === 'RECOMMENDED' || 
                         !t.requestStatus || 
                         ['ENGINEER', 'SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD'].includes(creator?.role || '') ||
                         ['ENGINEER', 'SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD'].includes(currentUser.role);

      if (isCompleted && isApproved) {
        const pts = Number(t.points) || 1;
        if (person.role === 'TECHNICIAN') {
          individualPoints += pts;
        } else if (person.role === 'OFFICER') {
          const isDirect = t.assignedTo === person.employeeId || t.assignedTo === person.name || t.assignedTo === person.id;
          if (isDirect) individualPoints += pts;
          else managedPoints += pts;
        } else {
          // Higher management roles above Officer aggregate managed points
          managedPoints += pts;
        }
      }
    });

    const totalPoints = individualPoints + managedPoints;

    return {
      tasks: employeeTasks,
      totalGiven,
      completed,
      running,
      pending,
      hold,
      completionRate,
      individualPoints,
      managedPoints,
      totalPoints
    };
  };

  // ==========================================
  // DYNAMIC FILTERABLE KPI CALCULATIONS FOR CBO
  // ==========================================

  // 1. KPI: Total Employees Monitored (Dynamic)
  const monitoredEmployeesList = useMemo(() => {
    return staffList.filter(isMonitoredByCBO);
  }, [staffList]);

  const totalEmployeesMonitored = useMemo(() => {
    return monitoredEmployeesList.length;
  }, [monitoredEmployeesList]);

  // Breakdown of monitored employees by active engagement in the selected period
  const activeMonitoredCountInPeriod = useMemo(() => {
    let activeCount = 0;
    monitoredEmployeesList.forEach(emp => {
      const m = getEmployeeMetrics(emp);
      if (m.totalGiven > 0) activeCount++;
    });
    return activeCount;
  }, [monitoredEmployeesList, periodTasks]);

  // Monitored role breakdown counts
  const roleBreakdownCounts = useMemo(() => {
    const counts: Record<string, number> = {
      HOD: 0,
      DHOD: 0,
      IN_CHARGE: 0,
      MODEL_MANAGER: 0,
      ENGINEER: 0,
      OFFICER: 0,
      TECHNICIAN: 0,
    };
    monitoredEmployeesList.forEach(s => {
      if (counts[s.role] !== undefined) {
        counts[s.role]++;
      }
    });
    return counts;
  }, [monitoredEmployeesList]);

  // 2. KPI: Overall Completion % (Dynamic for selected month & year)
  const overallCompletionMetrics = useMemo(() => {
    const total = periodTasks.length;
    let completed = 0;
    let running = 0;
    let pending = 0;
    let hold = 0;

    periodTasks.forEach(t => {
      const s = (t.status || '').toUpperCase();
      if (s === 'COMPLETED') completed++;
      else if (s === 'RUNNING') running++;
      else if (s === 'PENDING') pending++;
      else if (s === 'HOLD') hold++;
    });

    const percentage = total > 0 ? Math.round((completed / total) * 100 * 10) / 10 : 0;

    return {
      total,
      completed,
      running,
      pending,
      hold,
      percentage
    };
  }, [periodTasks]);

  // 3. KPI: Total Verified Task Points (Dynamic for selected month & year)
  const totalVerifiedTaskPoints = useMemo(() => {
    let sum = 0;
    periodTasks.forEach(t => {
      const isCompleted = (t.status || '').toUpperCase() === 'COMPLETED';
      const creator = staffList.find(s => s.employeeId === t.createdBy || s.id === t.createdBy);
      const isApproved = t.requestStatus === 'APPROVED' || 
                         t.requestStatus === 'RECOMMENDED' || 
                         !t.requestStatus || 
                         ['ENGINEER', 'SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD'].includes(creator?.role || '');

      if (isCompleted && isApproved) {
        sum += Number(t.points) || 1;
      }
    });
    return sum;
  }, [periodTasks, staffList]);

  // Additional CBO Insights
  const avgPointsPerTask = useMemo(() => {
    if (overallCompletionMetrics.completed === 0) return 0;
    return (totalVerifiedTaskPoints / overallCompletionMetrics.completed).toFixed(1);
  }, [totalVerifiedTaskPoints, overallCompletionMetrics.completed]);

  // Chart: Status distribution in period
  const statusChartData = useMemo(() => {
    return [
      { name: 'Completed', value: overallCompletionMetrics.completed, color: '#10B981' },
      { name: 'Running', value: overallCompletionMetrics.running, color: '#F59E0B' },
      { name: 'Pending', value: overallCompletionMetrics.pending, color: '#3B82F6' },
      { name: 'Hold', value: overallCompletionMetrics.hold, color: '#EF4444' }
    ].filter(item => item.value > 0);
  }, [overallCompletionMetrics]);

  // Chart: Role Completion Rate Breakdown
  const roleCompletionChartData = useMemo(() => {
    const roles: { key: Role; label: string }[] = [
      { key: 'HOD', label: 'HOD / DHOD' },
      { key: 'IN_CHARGE', label: 'In-Charge' },
      { key: 'MODEL_MANAGER', label: 'Model Mgr' },
      { key: 'ENGINEER', label: 'Engineer' },
      { key: 'OFFICER', label: 'Officer' },
      { key: 'TECHNICIAN', label: 'Technician' }
    ];

    return roles.map(r => {
      const staffInRole = staffList.filter(s => r.key === 'HOD' ? (s.role === 'HOD' || s.role === 'DHOD') : s.role === r.key);
      let given = 0;
      let comp = 0;
      let pts = 0;

      staffInRole.forEach(person => {
        const m = getEmployeeMetrics(person);
        given += m.totalGiven;
        comp += m.completed;
        pts += m.totalPoints;
      });

      const rate = given > 0 ? Math.round((comp / given) * 100) : 0;
      return {
        role: r.label,
        tasks: given,
        completed: comp,
        completionRate: rate,
        points: pts
      };
    });
  }, [staffList, periodTasks]);

  // Filtered workforce list for the management table
  const displayedStaff = useMemo(() => {
    let list = monitoredEmployeesList;

    // Filter by role category
    if (selectedRoleCategory === 'HOD') {
      list = list.filter(s => s.role === 'HOD' || s.role === 'DHOD');
    } else if (selectedRoleCategory !== 'ALL') {
      list = list.filter(s => s.role === selectedRoleCategory);
    }

    // Filter by department
    if (departmentFilter !== 'ALL') {
      list = list.filter(s => s.department === departmentFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => 
        s.name.toLowerCase().includes(q) ||
        s.employeeId.toLowerCase().includes(q) ||
        (s.designation && s.designation.toLowerCase().includes(q)) ||
        (s.department && s.department.toLowerCase().includes(q)) ||
        (s.section && s.section.toLowerCase().includes(q))
      );
    }

    const mapped = list.map(person => ({
      person,
      metrics: getEmployeeMetrics(person),
      attendanceStatus: getPersonAttendanceStatus(person.employeeId)
    }));

    // Performance rating filter
    if (performanceFilter === 'HIGH') {
      return mapped.filter(item => item.metrics.completionRate >= 80);
    } else if (performanceFilter === 'AVERAGE') {
      return mapped.filter(item => item.metrics.completionRate >= 50 && item.metrics.completionRate < 80);
    } else if (performanceFilter === 'LOW') {
      return mapped.filter(item => item.metrics.completionRate < 50);
    }

    return mapped;
  }, [monitoredEmployeesList, selectedRoleCategory, departmentFilter, searchQuery, performanceFilter, periodTasks, attendance]);

  // Associate Concerns (DCBO & HOD / DHOD) staff list for quick leadership oversight cards
  const hodPersonnel = useMemo(() => {
    return staffList.filter(s => s.role === 'DCBO' || s.role === 'HOD' || s.role === 'DHOD');
  }, [staffList]);

  // Export Executive CBO Report to Excel
  const handleExportReport = () => {
    try {
      const periodLabel = selectedMonth === 0 ? `Full_Year_${selectedYear}` : `${MONTH_NAMES[selectedMonth - 1]}_${selectedYear}`;
      const dataToExport = displayedStaff.map(item => ({
        'Employee ID': item.person.employeeId,
        'Name': item.person.name,
        'Role': item.person.role,
        'Department': item.person.department || 'N/A',
        'Section': item.person.section || 'N/A',
        'Attendance Today': item.attendanceStatus,
        'Tasks Given (Period)': item.metrics.totalGiven,
        'Tasks Completed': item.metrics.completed,
        'Tasks Running': item.metrics.running,
        'Tasks Pending': item.metrics.pending,
        'Tasks On Hold': item.metrics.hold,
        'Overall Completion %': `${item.metrics.completionRate}%`,
        'Individual Points': item.metrics.individualPoints,
        'Managed Subordinate Points': item.metrics.managedPoints,
        'Total Verified Points': item.metrics.totalPoints
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `CBO_${periodLabel}`);
      XLSX.writeFile(wb, `CBO_Executive_Monitoring_Report_${periodLabel}.xlsx`);
      toast.success(`CBO Executive Report exported for ${periodLabel.replace(/_/g, ' ')}`);
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to export executive report');
    }
  };

  // Submit direct task assignment to HOD
  const handleAssignTaskToHod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hodTaskData.title || !hodTaskData.assignedTo) {
      toast.error('Please specify a task title and select an HOD');
      return;
    }

    setIsSubmittingTask(true);
    const token = localStorage.getItem('token');
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: hodTaskData.title,
          assignedTo: hodTaskData.assignedTo,
          model: hodTaskData.model || 'General Work',
          details: hodTaskData.details || hodTaskData.title,
          urgency: hodTaskData.urgency,
          deadline: hodTaskData.deadline || new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
          points: Number(hodTaskData.points) || 1,
          estimatedDuration: hodTaskData.estimatedDuration,
          remarks: hodTaskData.remarks,
          workType: 'SINGLE'
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to assign executive task (HTTP ${res.status})`);
      }

      toast.success('Executive task assigned to HOD successfully');
      setIsAssignHodModalOpen(false);
      setHodTaskData({
        title: '',
        assignedTo: '',
        model: 'General Work',
        details: '',
        urgency: 'REGULAR',
        deadline: '',
        points: 1,
        estimatedDuration: '4 Hours',
        remarks: ''
      });
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      toast.error(err.message || 'Error assigning executive task');
    } finally {
      setIsSubmittingTask(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* ------------------------------------------------------------- */}
      {/* 1. TOP CBO EXECUTIVE HEADER & DYNAMIC MONTH/YEAR FILTER BAR */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950/70 to-slate-900 border border-blue-500/20 rounded-3xl p-6 lg:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="px-3 py-1 rounded-full text-xs font-black tracking-widest uppercase bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1.5 shadow-sm">
                <ShieldCheck size={14} className="text-blue-400" />
                CHIEF BUSINESS OFFICER (CBO) DASHBOARD
              </span>
              <span className="text-xs text-slate-400 font-medium tracking-wide">
                Executive Monitoring Layer • Hierarchical Operations Command
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
              Executive Business & Workforce Command Center
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              High-level strategic oversight of all organizational tiers: HODs, In-Charges, Model Managers, Engineers, Officers, and Technicians.
            </p>
          </div>

          {/* Dynamic Month & Year Filter Controls */}
          <div className="flex flex-wrap items-center gap-3 bg-black/40 border border-white/10 p-3 rounded-2xl shadow-inner">
            <div className="flex items-center gap-2 px-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <Calendar size={15} className="text-blue-400" />
              <span>Filter Period:</span>
            </div>

            {/* Month Selector */}
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              aria-label="Filter by month"
              className="bg-white/10 hover:bg-white/15 text-white text-xs font-bold px-3 py-2 rounded-xl border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors"
            >
              <option value={0} className="bg-slate-900 text-white font-medium">All Months (Full Year)</option>
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1} className="bg-slate-900 text-white font-medium">
                  {name}
                </option>
              ))}
            </select>

            {/* Year Selector */}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              aria-label="Filter by year"
              className="bg-white/10 hover:bg-white/15 text-white text-xs font-bold px-3 py-2 rounded-xl border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition-colors"
            >
              {availableYears.map(yr => (
                <option key={yr} value={yr} className="bg-slate-900 text-white font-medium">
                  {yr}
                </option>
              ))}
            </select>

            {/* Quick Reset to Current Month */}
            <button
              onClick={() => {
                setSelectedMonth(currentMonthNum);
                setSelectedYear(currentYearNum);
              }}
              title="Reset to current month and year"
              className={cn(
                "px-3 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer",
                selectedMonth === currentMonthNum && selectedYear === currentYearNum
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                  : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
              )}
            >
              <RefreshCw size={12} className={selectedMonth === currentMonthNum && selectedYear === currentYearNum ? "" : "text-blue-400"} />
              Current Month
            </button>

            {/* Direct Task Assignment to HOD */}
            <button
              onClick={() => setIsAssignHodModalOpen(true)}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-lg shadow-blue-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus size={14} />
              Assign to HOD
            </button>
          </div>
        </div>

        {/* Selected Period Status Ribbon */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              Dynamic Scope: <strong>{selectedMonth === 0 ? `Full Year ${selectedYear}` : `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`}</strong> 
              {' '}&bull; {periodTasks.length} total tasks registered in period
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportReport}
              className="hover:text-white flex items-center gap-1.5 transition-colors font-medium text-emerald-400 cursor-pointer"
            >
              <FileSpreadsheet size={14} />
              Export Excel Report
            </button>
            <span className="text-slate-600">&bull;</span>
            {onRefreshData && (
              <button
                onClick={onRefreshData}
                className="hover:text-white flex items-center gap-1.5 transition-colors font-medium text-blue-400 cursor-pointer"
              >
                <RefreshCw size={13} />
                Refresh Data
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2. PRIMARY DYNAMIC KPI CARDS (USER REQUIREMENTS)            */}
      {/*    - 'Total Employees Monitored'                              */}
      {/*    - 'Overall Completion %'                                   */}
      {/*    - 'Total Verified Task Points'                             */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* KPI CARD 1: Total Employees Monitored */}
        <div className="bg-gradient-to-br from-slate-900 to-blue-950/40 border border-blue-500/20 rounded-3xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md group hover:border-blue-500/40 transition-all">
          <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl group-hover:scale-125 transition-transform pointer-events-none" />
          
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
            <span className="text-blue-400">Workforce Scope</span>
            <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
              <Users size={20} />
            </div>
          </div>

          <h3 className="text-sm font-semibold text-slate-300">Total Employees Monitored</h3>
          
          <div className="mt-2 flex items-baseline gap-3">
            <div className="text-4xl font-black text-white tabular-nums tracking-tight font-mono">
              {totalEmployeesMonitored}
            </div>
            <div className="text-xs text-blue-400 font-semibold px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20">
              {activeMonitoredCountInPeriod} Active in Period
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 text-xs text-slate-400 flex flex-wrap gap-x-2 gap-y-1">
            <span>{roleBreakdownCounts.HOD + roleBreakdownCounts.DHOD} HODs</span>
            <span className="text-slate-600">&bull;</span>
            <span>{roleBreakdownCounts.IN_CHARGE} In-Charge</span>
            <span className="text-slate-600">&bull;</span>
            <span>{roleBreakdownCounts.MODEL_MANAGER} Model Mgr</span>
            <span className="text-slate-600">&bull;</span>
            <span>{roleBreakdownCounts.ENGINEER} Engineers</span>
            <span className="text-slate-600">&bull;</span>
            <span>{roleBreakdownCounts.OFFICER} Officers</span>
            <span className="text-slate-600">&bull;</span>
            <span>{roleBreakdownCounts.TECHNICIAN} Techs</span>
          </div>
        </div>

        {/* KPI CARD 2: Overall Completion % */}
        <div className="bg-gradient-to-br from-slate-900 to-emerald-950/40 border border-emerald-500/20 rounded-3xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md group hover:border-emerald-500/40 transition-all">
          <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl group-hover:scale-125 transition-transform pointer-events-none" />
          
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
            <span className="text-emerald-400">Execution Velocity</span>
            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <CheckCircle2 size={20} />
            </div>
          </div>

          <h3 className="text-sm font-semibold text-slate-300">Overall Completion %</h3>
          
          <div className="mt-2 flex items-baseline gap-3">
            <div className="text-4xl font-black text-emerald-300 tabular-nums tracking-tight font-mono">
              {overallCompletionMetrics.percentage}%
            </div>
            <div className="text-xs text-emerald-400 font-semibold px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              {overallCompletionMetrics.completed} / {overallCompletionMetrics.total} Done
            </div>
          </div>

          {/* Visual Progress Bar */}
          <div className="mt-3 w-full bg-white/10 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500" 
              style={{ width: `${Math.min(100, overallCompletionMetrics.percentage)}%` }}
            />
          </div>

          <div className="mt-3 pt-2 border-t border-white/10 text-xs text-slate-400 flex items-center justify-between">
            <span className="text-amber-400">{overallCompletionMetrics.running} Running</span>
            <span>{overallCompletionMetrics.pending} Pending</span>
            <span className="text-red-400">{overallCompletionMetrics.hold} Hold</span>
          </div>
        </div>

        {/* KPI CARD 3: Total Verified Task Points */}
        <div className="bg-gradient-to-br from-slate-900 to-purple-950/40 border border-purple-500/20 rounded-3xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md group hover:border-purple-500/40 transition-all">
          <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-purple-500/10 rounded-full blur-2xl group-hover:scale-125 transition-transform pointer-events-none" />
          
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-3">
            <span className="text-purple-400">Quality & Points</span>
            <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20 text-purple-400">
              <Award size={20} />
            </div>
          </div>

          <h3 className="text-sm font-semibold text-slate-300">Total Verified Task Points</h3>
          
          <div className="mt-2 flex items-baseline gap-3">
            <div className="text-4xl font-black text-purple-300 tabular-nums tracking-tight font-mono">
              {totalVerifiedTaskPoints}
            </div>
            <div className="text-xs text-purple-400 font-semibold px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20">
              Verified Source Points
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 text-xs text-slate-400 flex items-center justify-between">
            <span>Avg {avgPointsPerTask} pts / completed task</span>
            <span className="text-purple-400 font-medium">Non-duplicated audit</span>
          </div>
        </div>

      </div>

      {/* ------------------------------------------------------------- */}
      {/* 3. EXECUTIVE VISUAL ANALYTICS & STATUS MONITORING             */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Chart 1: Role Completion Breakdown */}
        <div className="lg:col-span-2 bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-white/10">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400 mb-1">
                <TrendingUp size={16} />
                <span>Workforce Productivity</span>
              </div>
              <h2 className="text-lg font-bold text-white">Tier-Wise Completion Rate & Volume</h2>
            </div>
            <div className="text-xs text-slate-400">
              Period: {selectedMonth === 0 ? `Full Year ${selectedYear}` : `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`}
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roleCompletionChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="role" stroke="#64748B" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748B" fontSize={11} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#FFF' }}
                  cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                />
                <Bar dataKey="tasks" name="Tasks Given" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Completed" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Task Status Distribution */}
        <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-400 mb-1">
              <Layers size={16} />
              <span>Status Ratio</span>
            </div>
            <h2 className="text-lg font-bold text-white mb-4">Task Status Distribution</h2>

            <div className="h-48 w-full">
              {statusChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                  No tasks registered in this period
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={4}
                    >
                      {statusChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#FFF' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-4 border-t border-white/10 text-xs">
            <div className="flex items-center gap-2 text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Completed ({overallCompletionMetrics.completed})</span>
            </div>
            <div className="flex items-center gap-2 text-amber-400">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span>Running ({overallCompletionMetrics.running})</span>
            </div>
            <div className="flex items-center gap-2 text-blue-400">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span>Pending ({overallCompletionMetrics.pending})</span>
            </div>
            <div className="flex items-center gap-2 text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span>Hold ({overallCompletionMetrics.hold})</span>
            </div>
          </div>
        </div>

      </div>

      {/* ------------------------------------------------------------- */}
      {/* 4. ASSOCIATE CONCERNS (DCBO & HOD) ATTENDANCE OVERSIGHT PANEL   */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400 mb-1">
              <Building2 size={16} />
              <span>Executive Subordinate Oversight (DCBO & HOD)</span>
            </div>
            <h2 className="text-xl font-bold text-white">Associate Concerns (DCBO & HOD) Status & Attendance</h2>
          </div>
          <div className="text-xs text-slate-400">
            Real-time attendance status for today ({todayDateStr})
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {hodPersonnel.length === 0 ? (
            <div className="col-span-full py-6 text-center text-slate-500 text-sm">
              No DCBO or HOD personnel currently registered.
            </div>
          ) : (
            hodPersonnel.map(hod => {
              const status = getPersonAttendanceStatus(hod.employeeId);
              const m = getEmployeeMetrics(hod);

              let statusBadgeClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
              if (status === 'ABSENT') statusBadgeClass = "bg-red-500/20 text-red-400 border-red-500/30";
              else if (status === 'LEAVE') statusBadgeClass = "bg-amber-500/20 text-amber-400 border-amber-500/30";
              else if (status === 'SHORT_LEAVE') statusBadgeClass = "bg-purple-500/20 text-purple-400 border-purple-500/30";

              return (
                <div key={hod.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-blue-500/30 transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className={cn("px-2 py-0.5 text-[10px] font-bold rounded-md border", statusBadgeClass)}>
                        {status}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {hod.role}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-white leading-tight">{hod.name}</h4>
                    <div className="text-xs text-slate-400 mt-1">ID: {hod.employeeId} &bull; {hod.department || 'Executive Dept'}</div>
                  </div>

                  {onUpdateAttendance && (
                    <div className="mt-3 pt-2 border-t border-white/10">
                      <div className="text-[10px] font-semibold text-slate-400 mb-1.5">Mark Attendance:</div>
                      <div className="grid grid-cols-4 gap-1">
                        {[
                          { label: 'P', full: 'PRESENT', title: 'Present' },
                          { label: 'L', full: 'LEAVE', title: 'Leave' },
                          { label: 'S', full: 'SHORT_LEAVE', title: 'Short Leave' },
                          { label: 'A', full: 'ABSENT', title: 'Absent' }
                        ].map(opt => (
                          <button
                            key={opt.full}
                            onClick={() => onUpdateAttendance(hod.employeeId, opt.full)}
                            title={opt.title}
                            className={cn(
                              "py-1 rounded text-[10px] font-black transition-all",
                              status === opt.full 
                                ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" 
                                : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-white/10">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-400">Completion</span>
                      <span className="font-bold text-emerald-400">{m.completionRate}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Tasks: {m.completed}/{m.totalGiven}</span>
                      <span className="text-purple-400 font-semibold">{m.totalPoints} pts</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 5. WORKFORCE MONITORING TABLE WITH CATEGORY TABS & SEARCH     */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-xl space-y-6">
        
        {/* Category Segmented Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400 mb-1">
              <Users size={16} />
              <span>Full Monitored Workforce</span>
            </div>
            <h2 className="text-xl font-bold text-white">Monitored Personnel Directory & Metrics</h2>
          </div>

          {/* Interactive Role Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-black/40 border border-white/10 rounded-2xl">
            {[
              { id: 'ALL', label: 'All Roles' },
              { id: 'HOD', label: 'HODs' },
              { id: 'IN_CHARGE', label: 'In-Charge' },
              { id: 'MODEL_MANAGER', label: 'Model Mgr' },
              { id: 'ENGINEER', label: 'Engineers' },
              { id: 'OFFICER', label: 'Officers' },
              { id: 'TECHNICIAN', label: 'Technicians' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setSelectedRoleCategory(tab.id)}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer whitespace-nowrap",
                  selectedRoleCategory === tab.id
                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Bar: Search, Department, Performance */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, ID, department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            aria-label="Filter by department"
            className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="ALL">All Departments</option>
            {availableDepartments.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <select
            value={performanceFilter}
            onChange={(e) => setPerformanceFilter(e.target.value)}
            aria-label="Filter by performance rating"
            className="w-full px-3 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="ALL">All Performance Ratings</option>
            <option value="HIGH">High (&ge; 80% Completion)</option>
            <option value="AVERAGE">Average (50% - 79%)</option>
            <option value="LOW">Needs Attention (&lt; 50%)</option>
          </select>
        </div>

        {/* Data Grid Table */}
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-white/5 uppercase tracking-wider text-[11px] text-slate-400 font-bold border-b border-white/10">
              <tr>
                <th className="py-3.5 px-4">Employee</th>
                <th className="py-3.5 px-3">Role & Dept</th>
                <th className="py-3.5 px-3">Attendance</th>
                <th className="py-3.5 px-3 text-right">Given</th>
                <th className="py-3.5 px-3 text-right">Completed</th>
                <th className="py-3.5 px-3 text-right">Running</th>
                <th className="py-3.5 px-3 text-right">Pending/Hold</th>
                <th className="py-3.5 px-4 text-center">Completion %</th>
                <th className="py-3.5 px-4 text-right">Points</th>
                <th className="py-3.5 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayedStaff.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    No matching personnel found for the selected filters.
                  </td>
                </tr>
              ) : (
                displayedStaff.map(({ person, metrics, attendanceStatus }) => {
                  let badgeColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                  if (attendanceStatus === 'ABSENT') badgeColor = "text-red-400 bg-red-500/10 border-red-500/20";
                  else if (attendanceStatus === 'LEAVE') badgeColor = "text-amber-400 bg-amber-500/10 border-amber-500/20";
                  else if (attendanceStatus === 'SHORT_LEAVE') badgeColor = "text-purple-400 bg-purple-500/10 border-purple-500/20";

                  return (
                    <tr key={person.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center font-bold text-blue-300 text-xs">
                            {person.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-white">{person.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono">ID: {person.employeeId}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="font-medium text-slate-200">{person.role.replace('_', ' ')}</div>
                        <div className="text-[11px] text-slate-400">{person.department || 'N/A'} {person.section ? `• ${person.section}` : ''}</div>
                      </td>

                      <td className="py-3.5 px-3">
                        {person.role === 'TECHNICIAN' ? (
                          <span className="text-slate-500 text-[11px] font-mono" title="Technician attendance managed by Officers">—</span>
                        ) : (
                          <span className={cn("px-2 py-0.5 rounded-md border text-[10px] font-bold", badgeColor)}>
                            {attendanceStatus}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono font-medium tabular-nums text-white">
                        {metrics.totalGiven}
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono font-medium tabular-nums text-emerald-400">
                        {metrics.completed}
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono font-medium tabular-nums text-amber-400">
                        {metrics.running}
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono font-medium tabular-nums text-blue-400">
                        {metrics.pending} / {metrics.hold}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 bg-white/10 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                "h-full rounded-full",
                                metrics.completionRate >= 80 ? "bg-emerald-500" :
                                metrics.completionRate >= 50 ? "bg-amber-500" : "bg-red-500"
                              )}
                              style={{ width: `${Math.min(100, metrics.completionRate)}%` }}
                            />
                          </div>
                          <span className="font-mono font-bold text-xs tabular-nums text-white">
                            {metrics.completionRate}%
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono font-bold tabular-nums text-purple-300">
                        {metrics.totalPoints}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => {
                            setSelectedStaff(person);
                            setIsDetailDrawerOpen(true);
                          }}
                          className="px-2.5 py-1 bg-white/5 hover:bg-blue-600/30 text-blue-400 hover:text-blue-200 border border-white/10 hover:border-blue-500/40 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 mx-auto cursor-pointer"
                        >
                          <Eye size={12} />
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-slate-400 flex items-center justify-between pt-2">
          <span>Showing {displayedStaff.length} monitored personnel</span>
          <span>Verified Task Points are non-duplicating source transactions</span>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 6. DETAIL SIDE DRAWER FOR MONITORED EMPLOYEE                  */}
      {/* ------------------------------------------------------------- */}
      {isDetailDrawerOpen && selectedStaff && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl bg-slate-900 border-l border-white/10 h-full p-6 overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Personnel Audit Profile</span>
                <h3 className="text-xl font-bold text-white">{selectedStaff.name}</h3>
                <div className="text-xs text-slate-400 font-mono">ID: {selectedStaff.employeeId} &bull; {selectedStaff.role}</div>
              </div>
              <button
                onClick={() => setIsDetailDrawerOpen(false)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Employee Metrics Highlight */}
            {(() => {
              const m = getEmployeeMetrics(selectedStaff);
              return (
                <div className="space-y-6">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                      <div className="text-xs text-slate-400">Given in Period</div>
                      <div className="text-2xl font-bold text-white font-mono mt-1">{m.totalGiven}</div>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                      <div className="text-xs text-emerald-400">Completion %</div>
                      <div className="text-2xl font-bold text-emerald-300 font-mono mt-1">{m.completionRate}%</div>
                    </div>
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 text-center">
                      <div className="text-xs text-purple-400">Total Points</div>
                      <div className="text-2xl font-bold text-purple-300 font-mono mt-1">{m.totalPoints}</div>
                    </div>
                  </div>

                  {/* Tasks List for Period */}
                  <div>
                    <h4 className="text-sm font-bold text-white mb-3">Tasks in Selected Period ({m.tasks.length})</h4>
                    <div className="space-y-2">
                      {m.tasks.length === 0 ? (
                        <div className="text-xs text-slate-500 text-center py-6">No tasks recorded for this employee in the selected period.</div>
                      ) : (
                        m.tasks.map(t => (
                          <div 
                            key={t.id} 
                            onClick={() => onSelectTask && onSelectTask(t)}
                            className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl cursor-pointer transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-white text-xs truncate">{t.title}</span>
                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                t.status === 'COMPLETED' ? "bg-emerald-500/20 text-emerald-400" :
                                t.status === 'RUNNING' ? "bg-amber-500/20 text-amber-400" :
                                "bg-blue-500/20 text-blue-400"
                              )}>
                                {t.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                              <span>Model: {t.model || 'General'}</span>
                              <span className="text-purple-400 font-mono font-semibold">{t.points || 1} pts</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 7. ASSIGN TASK TO HOD MODAL                                   */}
      {/* ------------------------------------------------------------- */}
      {isAssignHodModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Executive Task Delegation</span>
                <h3 className="text-lg font-bold text-white">Assign Task to Head of Department</h3>
              </div>
              <button
                onClick={() => setIsAssignHodModalOpen(false)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAssignTaskToHod} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Select HOD Assignee *</label>
                <select
                  value={hodTaskData.assignedTo}
                  onChange={(e) => setHodTaskData(prev => ({ ...prev, assignedTo: e.target.value }))}
                  required
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Choose Head of Department --</option>
                  {hodPersonnel.map(h => (
                    <option key={h.id} value={h.employeeId}>
                      {h.name} ({h.employeeId}) &bull; {h.department || 'Dept'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Task Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Q3 Production Yield Audit & Optimization Plan"
                  value={hodTaskData.title}
                  onChange={(e) => setHodTaskData(prev => ({ ...prev, title: e.target.value }))}
                  required
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Priority / Urgency</label>
                  <select
                    value={hodTaskData.urgency}
                    onChange={(e) => setHodTaskData(prev => ({ ...prev, urgency: e.target.value as any }))}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="REGULAR">Regular (1 Point)</option>
                    <option value="URGENT">Urgent (2 Points)</option>
                    <option value="MOST_URGENT">Most Urgent (3 Points)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Deadline</label>
                  <input
                    type="date"
                    value={hodTaskData.deadline}
                    onChange={(e) => setHodTaskData(prev => ({ ...prev, deadline: e.target.value }))}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Executive Directives & Details</label>
                <textarea
                  rows={3}
                  placeholder="Provide scope, deliverables, and expectations..."
                  value={hodTaskData.details}
                  onChange={(e) => setHodTaskData(prev => ({ ...prev, details: e.target.value }))}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAssignHodModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTask}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingTask ? 'Assigning...' : 'Assign Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CBODashboard;
