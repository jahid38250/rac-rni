import React, { useState, useMemo } from 'react';
import { 
  Building2, Users, CheckCircle2, Clock, AlertCircle, PauseCircle, 
  TrendingUp, Award, Search, Filter, Download, Plus, ChevronRight, 
  Eye, Calendar, BarChart3, ShieldCheck, ArrowUpRight, ChevronDown,
  Layers, UserCheck, Briefcase, Zap, FileSpreadsheet, RefreshCw, X,
  FileText, Check, AlertTriangle, UserCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import * as XLSX from 'xlsx';
import { cn } from './utils';
import { User, Task, Attendance, Role } from './types';
import { toast } from 'sonner';

interface ExecutiveCommandCenterProps {
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

const WORKFORCE_ROLES: Role[] = ['IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER', 'TECHNICIAN'];

export const ExecutiveCommandCenter: React.FC<ExecutiveCommandCenterProps> = ({
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

  // Check if current user is HOD or DHOD (specifically IDs 19219 or 17668, or role HOD/DHOD)
  const isHodView = currentUser.role === 'HOD' || 
                    currentUser.role === 'DHOD' || 
                    currentUser.employeeId === '19219' || 
                    currentUser.employeeId === '17668';

  // For HOD panel: Hierarchy starts from In-Charge down. CBO, DCBO, and HODs must NOT appear as associates.
  const activeStaffList = useMemo(() => {
    if (isHodView) {
      return staffList.filter(s => 
        s.role !== 'CBO' && 
        s.role !== 'DCBO' && 
        s.role !== 'HOD' && 
        s.role !== 'DHOD' && 
        s.employeeId !== '1007' && 
        s.employeeId !== '12467' && 
        s.employeeId !== '19219' && 
        s.employeeId !== '17668' &&
        WORKFORCE_ROLES.includes(s.role)
      );
    }
    return staffList;
  }, [staffList, isHodView]);

  // In-Charge list (direct operational associates under HOD/DHOD)
  const inChargeStaffList = useMemo(() => {
    return activeStaffList.filter(s => s.role === 'IN_CHARGE');
  }, [activeStaffList]);

  // Month & Year state
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonthNum);
  const [selectedYear, setSelectedYear] = useState<number>(currentYearNum);

  // Active Category Tab: 'OVERVIEW' | 'IN_CHARGE' | 'MODEL_MANAGER' | 'ENGINEER' | 'OFFICER' | 'TECHNICIAN' | 'HOD'
  const [activeCategory, setActiveCategory] = useState<string>('OVERVIEW');

  // Search & Filters within table
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [performanceFilter, setPerformanceFilter] = useState('ALL');

  // Detail Drawer state
  const [selectedPerson, setSelectedPerson] = useState<User | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);

  // Point Audit Drawer state
  const [auditTarget, setAuditTarget] = useState<User | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  // Task Assign Modal state
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

  // Available dynamic years
  const availableYears = useMemo(() => {
    const yearsSet = new Set<number>([currentYearNum, currentYearNum - 1, currentYearNum + 1]);
    tasks.forEach(t => {
      if (t.createdAt) {
        const y = new Date(t.createdAt).getFullYear();
        if (!isNaN(y) && y > 2020 && y < 2035) yearsSet.add(y);
      }
      if (t.deadline) {
        const y = new Date(t.deadline).getFullYear();
        if (!isNaN(y) && y > 2020 && y < 2035) yearsSet.add(y);
      }
    });
    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [tasks, currentYearNum]);

  // Departments list for filtering
  const departments = useMemo(() => {
    const depts = new Set<string>();
    activeStaffList.forEach(s => {
      if (s.department && s.department.trim()) depts.add(s.department.trim());
    });
    return Array.from(depts);
  }, [activeStaffList]);

  // Filter tasks strictly by selected month and year
  const periodTasks = useMemo(() => {
    const targetPrefix = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    return tasks.filter(t => {
      if (t.createdAt && t.createdAt.startsWith(targetPrefix)) return true;
      if (t.completedAt && t.completedAt.startsWith(targetPrefix)) return true;
      if (t.deadline && t.deadline.startsWith(targetPrefix)) return true;
      
      // Fallback check with Date object
      if (t.createdAt) {
        const d = new Date(t.createdAt);
        if (d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear) return true;
      }
      if (t.deadline) {
        const d = new Date(t.deadline);
        if (d.getMonth() + 1 === selectedMonth && d.getFullYear() === selectedYear) return true;
      }
      return false;
    });
  }, [tasks, selectedMonth, selectedYear]);

  // HOD & DHOD list
  const hodStaffList = useMemo(() => {
    return staffList.filter(s => s.role === 'HOD' || s.role === 'DHOD');
  }, [staffList]);

  // DCBO list (if CBO is viewing)
  const dcboStaffList = useMemo(() => {
    return staffList.filter(s => s.role === 'DCBO');
  }, [staffList]);

  // Today string for attendance
  const todayDateStr = useMemo(() => {
    return new Date().toISOString().split('T')[0];
  }, []);

  // Helper to get person attendance status today
  const getPersonTodayAttendance = (empId: string): string => {
    const rec = attendance.find(a => a.technicianId === empId && a.date === todayDateStr);
    if (rec) return rec.status;
    const u = staffList.find(s => s.employeeId === empId);
    if (u?.status === 'ON_LEAVE') return 'LEAVE';
    if (u?.status === 'SHORT_LEAVE') return 'SHORT_LEAVE';
    return 'PRESENT'; // default standard present
  };

  // Helper: resolve responsible Officer and Engineer for a task (Rule 21 & 11-15)
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

  // Helper: check if task is associated with a person across the hierarchy
  const isTaskForPerson = (task: Task, person: User): boolean => {
    const empId = person.employeeId;
    const name = person.name;
    const id = person.id;

    // Directly assigned
    if (task.assignedTo === empId || task.assignedTo === name || task.assignedTo === id || (name && task.assignedTo && task.assignedTo.toLowerCase().trim() === name.toLowerCase().trim())) return true;

    // Team technician
    if (task.workType === 'TEAM' && Array.isArray(task.assignedTechnicians)) {
      if (task.assignedTechnicians.some(t => t.employeeId === empId || t.name === name)) return true;
    }

    if (person.role === 'TECHNICIAN') {
      return false;
    }

    // Created or assigned by
    if (task.createdBy === empId || task.createdBy === id || task.createdBy === name || task.assignedBy === empId) {
      return true;
    }

    const { creator, assigner, assignee, responsibleOfficer, responsibleEngineer } = resolveTaskHierarchy(task);

    if (person.role === 'OFFICER') {
      if (responsibleOfficer?.employeeId === empId) return true;
      if (assignee?.role === 'TECHNICIAN' && (assignee.supervisorId === id || assignee.supervisorId === empId)) return true;
      return false;
    }

    // Role-specific supervisory relationship: ONLY credit the specific Engineer who gave, approved, or is responsible for this task
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
      // DHOD and HOD oversee all department tasks
      if (!person.department) return true;
      if (!creator?.department || creator.department === person.department) return true;
      if (!assignee?.department || assignee.department === person.department) return true;
      return true;
    }

    return false;
  };

  // Helper: calculate person metrics for selected month/year (Rules 9-25)
  const getPersonPeriodMetrics = (person: User) => {
    const personTasks = periodTasks.filter(t => isTaskForPerson(t, person));
    const totalTasksGiven = personTasks.length;
    const completedTasks = personTasks.filter(t => (t.status || '').toUpperCase() === 'COMPLETED').length;
    const runningTasks = personTasks.filter(t => (t.status || '').toUpperCase() === 'RUNNING').length;
    const pendingTasks = personTasks.filter(t => (t.status || '').toUpperCase() === 'PENDING').length;
    const holdTasks = personTasks.filter(t => (t.status || '').toUpperCase() === 'HOLD').length;

    // Rule 9: performancePercentage = (totalCompletedTasks / totalWorkEntries) * 100
    // If totalWorkEntries = 0: performancePercentage = 0
    const performancePercentage = totalTasksGiven > 0 
      ? Math.round((completedTasks / totalTasksGiven) * 100 * 10) / 10 
      : 0;

    // Point Calculation: Source Points & Subordinate Points (No duplicate points, Rule 17 enforced)
    let individualPoints = 0;
    let aggregatedSubordinatePoints = 0;

    personTasks.forEach(t => {
      const isCompleted = (t.status || '').toUpperCase() === 'COMPLETED';
      const creator = staffList.find(s => s.employeeId === t.createdBy || s.id === t.createdBy);
      const isApproved = t.requestStatus === 'APPROVED' || 
                         t.requestStatus === 'RECOMMENDED' || 
                         !t.requestStatus || 
                         ['ENGINEER', 'SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD'].includes(creator?.role || '') ||
                         ['ENGINEER', 'SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD'].includes(currentUser.role);

      if (isCompleted && isApproved) {
        const pts = Number(t.points) || 0;
        if (pts <= 0) return;

        if (person.role === 'TECHNICIAN') {
          // Rule 9 & 10: Technician receives personal points only
          individualPoints += pts;
        } else if (person.role === 'OFFICER') {
          // Rule 10: Officer receives personal points if directly assigned, or managed points for technician tasks
          const isDirectlyAssigned = t.assignedTo === person.employeeId || t.assignedTo === person.name || t.assignedTo === person.id;
          if (isDirectlyAssigned) {
            individualPoints += pts;
          } else {
            aggregatedSubordinatePoints += pts;
          }
        } else {
          // Rule 17: Higher management roles above Officer (ENGINEER, MODEL_MANAGER, IN_CHARGE, DHOD, HOD)
          // have 0 personal points; all verified points under their scope are managed/aggregated points
          aggregatedSubordinatePoints += pts;
        }
      }
    });

    const totalTaskPoints = individualPoints + aggregatedSubordinatePoints;

    return {
      personTasks,
      totalTasksGiven,
      completedTasks,
      runningTasks,
      pendingTasks,
      holdTasks,
      performancePercentage,
      individualPoints,
      aggregatedSubordinatePoints,
      totalTaskPoints
    };
  };

  // High-level Category Overview Metrics
  const categoryMetrics = useMemo(() => {
    const roles: Role[] = isHodView
      ? ['IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER', 'TECHNICIAN']
      : ['IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER', 'TECHNICIAN', 'DHOD', 'HOD'];
    const summary: Record<string, {
      headcount: number;
      totalTasks: number;
      completed: number;
      running: number;
      pending: number;
      hold: number;
      avgPerformance: number;
      totalPoints: number;
    }> = {};

    roles.forEach(r => {
      const staffInRole = activeStaffList.filter(s => s.role === r);
      let totalTasks = 0;
      let completed = 0;
      let running = 0;
      let pending = 0;
      let hold = 0;
      let totalPoints = 0;

      staffInRole.forEach(person => {
        const m = getPersonPeriodMetrics(person);
        totalTasks += m.totalTasksGiven;
        completed += m.completedTasks;
        running += m.runningTasks;
        pending += m.pendingTasks;
        hold += m.holdTasks;
        totalPoints += m.totalTaskPoints;
      });

      const avgPerformance = totalTasks > 0 ? Math.round((completed / totalTasks) * 100 * 10) / 10 : 0;

      summary[r] = {
        headcount: staffInRole.length,
        totalTasks,
        completed,
        running,
        pending,
        hold,
        avgPerformance,
        totalPoints
      };
    });

    return summary;
  }, [activeStaffList, periodTasks, isHodView]);

  // Overall enterprise metrics across all staff for selected period
  const overallEnterpriseMetrics = useMemo(() => {
    let totalCompleted = 0;
    let totalRunning = 0;
    let totalPending = 0;
    let totalHold = 0;
    let totalVerifiedPoints = 0;

    periodTasks.forEach(t => {
      const status = (t.status || '').toUpperCase();
      if (status === 'COMPLETED') {
        totalCompleted++;
        totalVerifiedPoints += Number(t.points) || 1;
      } else if (status === 'RUNNING') {
        totalRunning++;
      } else if (status === 'PENDING') {
        totalPending++;
      } else if (status === 'HOLD') {
        totalHold++;
      }
    });

    const totalTasks = periodTasks.length;
    const overallPerformance = totalTasks > 0 
      ? Math.round((totalCompleted / totalTasks) * 100 * 10) / 10 
      : 0;

    return {
      totalStaff: activeStaffList.length,
      totalTasks,
      totalCompleted,
      totalRunning,
      totalPending,
      totalHold,
      overallPerformance,
      totalVerifiedPoints
    };
  }, [periodTasks, activeStaffList]);

  // Chart data: Completion & Performance by category
  const roleChartData = useMemo(() => {
    return [
      { name: 'In-Charge', completed: categoryMetrics['IN_CHARGE']?.completed || 0, running: categoryMetrics['IN_CHARGE']?.running || 0, pending: categoryMetrics['IN_CHARGE']?.pending || 0, performance: categoryMetrics['IN_CHARGE']?.avgPerformance || 0 },
      { name: 'Model Mgr', completed: categoryMetrics['MODEL_MANAGER']?.completed || 0, running: categoryMetrics['MODEL_MANAGER']?.running || 0, pending: categoryMetrics['MODEL_MANAGER']?.pending || 0, performance: categoryMetrics['MODEL_MANAGER']?.avgPerformance || 0 },
      { name: 'Engineer', completed: categoryMetrics['ENGINEER']?.completed || 0, running: categoryMetrics['ENGINEER']?.running || 0, pending: categoryMetrics['ENGINEER']?.pending || 0, performance: categoryMetrics['ENGINEER']?.avgPerformance || 0 },
      { name: 'Officer', completed: categoryMetrics['OFFICER']?.completed || 0, running: categoryMetrics['OFFICER']?.running || 0, pending: categoryMetrics['OFFICER']?.pending || 0, performance: categoryMetrics['OFFICER']?.avgPerformance || 0 },
      { name: 'Technician', completed: categoryMetrics['TECHNICIAN']?.completed || 0, running: categoryMetrics['TECHNICIAN']?.running || 0, pending: categoryMetrics['TECHNICIAN']?.pending || 0, performance: categoryMetrics['TECHNICIAN']?.avgPerformance || 0 }
    ];
  }, [categoryMetrics]);

  // Chart data: Status distribution
  const statusPieData = useMemo(() => {
    return [
      { name: 'Completed', value: overallEnterpriseMetrics.totalCompleted, color: '#10B981' },
      { name: 'Running', value: overallEnterpriseMetrics.totalRunning, color: '#F59E0B' },
      { name: 'Pending', value: overallEnterpriseMetrics.totalPending, color: '#3B82F6' },
      { name: 'Hold', value: overallEnterpriseMetrics.totalHold, color: '#EF4444' }
    ].filter(item => item.value > 0);
  }, [overallEnterpriseMetrics]);

  // Filtered staff list for the active category table
  const displayedStaffList = useMemo(() => {
    let list = activeStaffList;
    if (activeCategory === 'OVERVIEW') {
      list = activeStaffList.filter(s => WORKFORCE_ROLES.includes(s.role) || (!isHodView && (s.role === 'HOD' || s.role === 'DHOD')));
    } else if (activeCategory === 'HOD' && !isHodView) {
      list = activeStaffList.filter(s => s.role === 'HOD' || s.role === 'DHOD');
    } else {
      list = activeStaffList.filter(s => s.role === activeCategory);
    }

    // Apply department filter
    if (departmentFilter !== 'ALL') {
      list = list.filter(s => s.department === departmentFilter);
    }

    // Apply search query
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

    // Map each person with metrics for sorting and display
    const mapped = list.map(person => ({
      person,
      metrics: getPersonPeriodMetrics(person),
      attendanceStatus: getPersonTodayAttendance(person.employeeId)
    }));

    // Apply performance filter
    if (performanceFilter === 'HIGH') {
      return mapped.filter(item => item.metrics.performancePercentage >= 80);
    } else if (performanceFilter === 'AVERAGE') {
      return mapped.filter(item => item.metrics.performancePercentage >= 50 && item.metrics.performancePercentage < 80);
    } else if (performanceFilter === 'LOW') {
      return mapped.filter(item => item.metrics.performancePercentage < 50);
    }

    return mapped;
  }, [staffList, activeCategory, departmentFilter, searchQuery, performanceFilter, periodTasks, attendance]);

  // Export Executive Monitoring Report to Excel
  const handleExportExcel = () => {
    try {
      const monthName = MONTH_NAMES[selectedMonth - 1];
      const dataToExport = displayedStaffList.map(item => ({
        'Employee ID': item.person.employeeId,
        'Name': item.person.name,
        'Role': item.person.role,
        'Department': item.person.department || 'N/A',
        'Section': item.person.section || 'N/A',
        'Attendance Today': item.attendanceStatus,
        'Total Tasks Given': item.metrics.totalTasksGiven,
        'Completed': item.metrics.completedTasks,
        'Running': item.metrics.runningTasks,
        'Pending': item.metrics.pendingTasks,
        'Hold': item.metrics.holdTasks,
        'Performance %': `${item.metrics.performancePercentage}%`,
        'Individual Points': item.metrics.individualPoints,
        'Aggregated Points': item.metrics.aggregatedSubordinatePoints,
        'Total Accumulated Points': item.metrics.totalTaskPoints
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `${monthName}_${selectedYear}`);
      XLSX.writeFile(wb, `Executive_Workforce_Monitoring_${monthName}_${selectedYear}.xlsx`);
      toast.success(`Executive report for ${monthName} ${selectedYear} exported successfully`);
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to export executive report');
    }
  };

  // Submit quick task assignment to HOD
  const handleAssignTaskToHod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hodTaskData.title || !hodTaskData.assignedTo) {
      toast.error('Please specify task title and assign an HOD');
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
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errJson = await res.json();
          throw new Error(errJson.error || 'Failed to create executive task');
        }
        throw new Error(`Failed to create executive task (Status ${res.status})`);
      }

      toast.success(`Executive task assigned to HOD successfully`);
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
      toast.error(err.message || 'Error assigning task');
    } finally {
      setIsSubmittingTask(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Executive Header & Filter Ribbon */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950/60 to-slate-900 border border-blue-500/20 rounded-3xl p-6 lg:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

        <div className="relative z-10 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="px-3 py-1 rounded-full text-xs font-black tracking-widest uppercase bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1.5 shadow-sm">
                <ShieldCheck size={14} className="text-blue-400" />
                {currentUser.role === 'CBO' ? 'CHIEF BUSINESS OFFICER' :
                 currentUser.role === 'DCBO' ? 'DEPUTY CHIEF BUSINESS OFFICER' :
                 currentUser.employeeId === '19219' || currentUser.role === 'HOD' ? 'HEAD OF DEPARTMENT (HOD)' :
                 currentUser.employeeId === '17668' || currentUser.role === 'DHOD' ? 'DEPUTY HEAD OF DEPARTMENT (DHOD)' :
                 'DEPARTMENT COMMAND'}
              </span>
              <span className="text-xs text-slate-400 font-medium tracking-wide">
                {isHodView ? 'HOD Operations Command • RAC R&I Department Monitoring' : 'Executive Monitoring Layer • Hierarchical Operations Command'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
              {isHodView ? 'Department Operations & Workforce Command Center' : 'Executive Business & Workforce Command Center'}
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              {isHodView 
                ? 'Real-time operational monitoring of all In-Charges, Model Managers, Engineers, Officers, and Technicians in RAC R&I.' 
                : 'Real-time enterprise monitoring of all In-Charges, Model Managers, Engineers, Officers, Technicians, and HODs.'}
            </p>
          </div>

          {/* Month + Year Filter Bar */}
          <div className="flex flex-wrap items-center gap-3 bg-black/40 border border-white/10 p-2.5 rounded-2xl shadow-inner">
            <div className="flex items-center gap-2 px-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
              <Calendar size={15} className="text-blue-400" />
              <span>Period:</span>
            </div>

            {/* Month Selector */}
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-white/10 hover:bg-white/15 text-white text-xs font-bold px-3 py-2 rounded-xl border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
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
              className="bg-white/10 hover:bg-white/15 text-white text-xs font-bold px-3 py-2 rounded-xl border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {availableYears.map(year => (
                <option key={year} value={year} className="bg-slate-900 text-white font-medium">
                  {year}
                </option>
              ))}
            </select>

            {/* Quick Reset to Current Month */}
            <button
              onClick={() => {
                setSelectedMonth(currentMonthNum);
                setSelectedYear(currentYearNum);
              }}
              title="Reset to Current Month"
              className={cn(
                "px-3 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5",
                selectedMonth === currentMonthNum && selectedYear === currentYearNum
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                  : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
              )}
            >
              <RefreshCw size={12} className={selectedMonth === currentMonthNum && selectedYear === currentYearNum ? "" : "text-blue-400"} />
              Current Month
            </button>

            {/* Assign Task button */}
            <button
              onClick={() => {
                if (isHodView && onOpenNewTaskModal) {
                  onOpenNewTaskModal();
                } else {
                  setIsAssignHodModalOpen(true);
                }
              }}
              className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-lg shadow-blue-600/30 flex items-center gap-1.5 transition-all"
            >
              <Plus size={14} />
              {isHodView ? "Assign New Task" : "Assign to HOD"}
            </button>
          </div>
        </div>

        {/* Selected Period Active Notice */}
        <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Viewing dynamic data for: <strong>{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</strong> ({periodTasks.length} total tasks registered in period)</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportExcel}
              className="hover:text-white flex items-center gap-1.5 transition-colors font-medium text-emerald-400"
            >
              <FileSpreadsheet size={14} />
              Export Excel Report
            </button>
            <span className="text-slate-600">•</span>
            {onRefreshData && (
              <button
                onClick={onRefreshData}
                className="hover:text-white flex items-center gap-1.5 transition-colors font-medium text-blue-400"
              >
                <RefreshCw size={13} />
                Refresh Data
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Top Enterprise KPIs Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-blue-500/30 transition-all backdrop-blur-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Workforce</span>
            <Users size={16} className="text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white">{overallEnterpriseMetrics.totalStaff}</div>
          <div className="text-[11px] text-slate-400 mt-1">Total active personnel</div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-indigo-500/30 transition-all backdrop-blur-md">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Total Tasks</span>
            <Briefcase size={16} className="text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-white">{overallEnterpriseMetrics.totalTasks}</div>
          <div className="text-[11px] text-slate-400 mt-1">Given in {MONTH_NAMES[selectedMonth - 1]}</div>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 hover:border-emerald-500/40 transition-all backdrop-blur-md">
          <div className="flex items-center justify-between text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Completed</span>
            <CheckCircle2 size={16} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-300">{overallEnterpriseMetrics.totalCompleted}</div>
          <div className="text-[11px] text-emerald-400/80 mt-1 font-semibold">{overallEnterpriseMetrics.overallPerformance}% Completion</div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 hover:border-amber-500/40 transition-all backdrop-blur-md">
          <div className="flex items-center justify-between text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Running</span>
            <Clock size={16} className="text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300">{overallEnterpriseMetrics.totalRunning}</div>
          <div className="text-[11px] text-amber-400/80 mt-1">Currently in progress</div>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 hover:border-blue-500/40 transition-all backdrop-blur-md">
          <div className="flex items-center justify-between text-blue-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Pending / Hold</span>
            <PauseCircle size={16} className="text-blue-400" />
          </div>
          <div className="text-2xl font-black text-blue-300">
            {overallEnterpriseMetrics.totalPending} <span className="text-sm font-normal text-slate-400">/ {overallEnterpriseMetrics.totalHold}</span>
          </div>
          <div className="text-[11px] text-blue-400/80 mt-1">{overallEnterpriseMetrics.totalHold} on hold</div>
        </div>

        <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-4 hover:border-purple-500/40 transition-all backdrop-blur-md">
          <div className="flex items-center justify-between text-purple-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Total Points</span>
            <Award size={16} className="text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-300">{overallEnterpriseMetrics.totalVerifiedPoints}</div>
          <div className="text-[11px] text-purple-400/80 mt-1">Verified source points</div>
        </div>
      </div>

      {/* Associated Operational Monitoring: In-Charges for HOD/DHOD, HODs for CBO/DCBO */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400 mb-1">
              <Building2 size={16} />
              <span>{isHodView ? 'Section & Unit Operational Monitoring' : 'Hierarchical HOD Monitoring'}</span>
            </div>
            <h2 className="text-xl font-bold text-white">
              {isHodView ? 'Associated In-Charge Attendance & Section Operations' : 'Associated HOD Attendance & Department Operations'}
            </h2>
          </div>
          <div className="text-xs text-slate-400">
            Source of Truth: Real-time system attendance records ({todayDateStr})
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(isHodView ? inChargeStaffList : hodStaffList).length === 0 ? (
            <div className="col-span-full py-8 text-center text-slate-500 text-sm">
              {isHodView ? 'No In-Charge personnel currently registered in system.' : 'No HOD personnel currently registered in system.'}
            </div>
          ) : (
            (isHodView ? inChargeStaffList : hodStaffList).map(person => {
              const status = getPersonTodayAttendance(person.employeeId);
              const personMetrics = getPersonPeriodMetrics(person);
              
              // Status color mapping
              let statusBadgeClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
              if (status === 'ABSENT') statusBadgeClass = "bg-red-500/20 text-red-400 border-red-500/30";
              else if (status === 'LEAVE') statusBadgeClass = "bg-amber-500/20 text-amber-400 border-amber-500/30";
              else if (status === 'SHORT_LEAVE') statusBadgeClass = "bg-purple-500/20 text-purple-400 border-purple-500/30";

              return (
                <div 
                  key={person.id}
                  className="bg-white/5 border border-white/10 hover:border-blue-500/40 rounded-2xl p-5 transition-all group relative overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="font-bold text-white text-base truncate group-hover:text-blue-300 transition-colors">
                        {person.name}
                      </div>
                      <div className="text-xs text-slate-400 truncate">
                        ID: {person.employeeId} • {person.section || person.department || 'RAC R&I'}
                      </div>
                    </div>
                    <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shrink-0", statusBadgeClass)}>
                      {status}
                    </span>
                  </div>

                  {/* Metrics summary */}
                  <div className="grid grid-cols-3 gap-2 py-3 border-y border-white/5 text-center my-3">
                    <div>
                      <div className="text-xs text-slate-400">Tasks</div>
                      <div className="text-sm font-bold text-white">{personMetrics.totalTasksGiven}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Done</div>
                      <div className="text-sm font-bold text-emerald-400">{personMetrics.completedTasks}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Perf %</div>
                      <div className="text-sm font-bold text-blue-400">{personMetrics.performancePercentage}%</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between gap-2 mt-3 pt-1">
                    <button
                      onClick={() => {
                        setSelectedPerson(person);
                        setIsDetailDrawerOpen(true);
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1 transition-colors"
                    >
                      <Eye size={13} />
                      View Details
                    </button>
                    {onUpdateAttendance && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onUpdateAttendance(person.employeeId, 'PRESENT')}
                          title="Mark Present"
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold transition-all",
                            status === 'PRESENT' ? "bg-emerald-500 text-white" : "bg-white/5 hover:bg-emerald-500/20 text-slate-400"
                          )}
                        >
                          P
                        </button>
                        <button
                          onClick={() => onUpdateAttendance(person.employeeId, 'LEAVE')}
                          title="Mark Leave"
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold transition-all",
                            status === 'LEAVE' ? "bg-amber-500 text-white" : "bg-white/5 hover:bg-amber-500/20 text-slate-400"
                          )}
                        >
                          L
                        </button>
                        <button
                          onClick={() => onUpdateAttendance(person.employeeId, 'ABSENT')}
                          title="Mark Absent"
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold transition-all",
                            status === 'ABSENT' ? "bg-red-500 text-white" : "bg-white/5 hover:bg-red-500/20 text-slate-400"
                          )}
                        >
                          A
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Visual Analytics & Distribution Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance by Category Bar Chart */}
        <div className="lg:col-span-2 bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-lg text-white">Workforce Performance & Task Status by Category</h3>
              <p className="text-xs text-slate-400">Comparative task volume & completion for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
            </div>
            <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
              5 Major Roles
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roleChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#64748B" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748B" fontSize={11} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="completed" name="Completed" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="running" name="Running" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pending" name="Pending" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Task Status Share Donut Chart */}
        <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-xl flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-lg text-white">Monthly Workload Distribution</h3>
            <p className="text-xs text-slate-400">Total {periodTasks.length} active tasks in period</p>
          </div>

          <div className="h-48 w-full my-auto">
            {statusPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                  >
                    {statusPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                No task data in selected period
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs pt-3 border-t border-white/5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-slate-300">Completed: <strong>{overallEnterpriseMetrics.totalCompleted}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="text-slate-300">Running: <strong>{overallEnterpriseMetrics.totalRunning}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-slate-300">Pending: <strong>{overallEnterpriseMetrics.totalPending}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-slate-300">Hold: <strong>{overallEnterpriseMetrics.totalHold}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Point Hierarchy & Traceability Banner (Sections 11, 12, 13) */}
      <div className="bg-gradient-to-r from-purple-950/40 via-slate-900 to-indigo-950/40 border border-purple-500/20 rounded-3xl p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Zap size={20} />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Traceable Point Aggregation & Hierarchy Architecture</h3>
              <p className="text-xs text-slate-400">
                Technician → Officer → Engineer → Model Manager → In-Charge → DHOD → HOD → DCBO → CBO • Strict No-Duplicate Verified Point Engine
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-purple-300 bg-purple-500/10 px-3 py-1.5 rounded-xl border border-purple-500/20">
            <Award size={14} />
            <span>Engineer → Officer Verified Points Roll-up Enforced</span>
          </div>
        </div>

        {/* Visual Hierarchy Flow */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold py-2 overflow-x-auto custom-scrollbar">
          <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 flex items-center gap-1.5">
            <span className="text-slate-500 font-mono">1</span> Technician
          </div>
          <ChevronRight size={14} className="text-slate-600 shrink-0" />
          <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 flex items-center gap-1.5">
            <span className="text-slate-500 font-mono">2</span> Officer
          </div>
          <ChevronRight size={14} className="text-slate-600 shrink-0" />
          <div className="px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 flex items-center gap-1.5">
            <span className="text-indigo-400 font-mono">3</span> Engineer (Aggregates Officers)
          </div>
          <ChevronRight size={14} className="text-slate-600 shrink-0" />
          <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 flex items-center gap-1.5">
            <span className="text-slate-500 font-mono">4</span> Model Manager
          </div>
          <ChevronRight size={14} className="text-slate-600 shrink-0" />
          <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 flex items-center gap-1.5">
            <span className="text-slate-500 font-mono">5</span> In-Charge
          </div>
          {isHodView ? (
            <>
              <ChevronRight size={14} className="text-slate-600 shrink-0" />
              <div className="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold flex items-center gap-1.5">
                <span className="text-blue-400 font-mono">6</span> HOD / DHOD (Department Command)
              </div>
            </>
          ) : (
            <>
              <ChevronRight size={14} className="text-slate-600 shrink-0" />
              <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 flex items-center gap-1.5">
                <span className="text-slate-500 font-mono">6</span> DHOD
              </div>
              <ChevronRight size={14} className="text-slate-600 shrink-0" />
              <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 flex items-center gap-1.5">
                <span className="text-slate-500 font-mono">7</span> HOD
              </div>
              <ChevronRight size={14} className="text-slate-600 shrink-0" />
              <div className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 flex items-center gap-1.5">
                <span className="text-purple-400 font-mono">8</span> DCBO
              </div>
              <ChevronRight size={14} className="text-slate-600 shrink-0" />
              <div className="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 font-bold flex items-center gap-1.5">
                <span className="text-blue-400 font-mono">9</span> CBO (Enterprise Command)
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Workforce Categories Tabs & Monitoring Table */}
      <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 shadow-xl backdrop-blur-xl space-y-6">
        {/* Category Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveCategory('OVERVIEW')}
              className={cn(
                "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
                activeCategory === 'OVERVIEW'
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                  : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5"
              )}
            >
              <Layers size={14} />
              ALL WORKFORCE ({activeStaffList.length})
            </button>

            {WORKFORCE_ROLES.map(role => {
              const label = role.replace(/_/g, ' ');
              const count = activeStaffList.filter(s => s.role === role).length;
              const isActive = activeCategory === role;

              return (
                <button
                  key={role}
                  onClick={() => setActiveCategory(role)}
                  className={cn(
                    "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 uppercase",
                    isActive
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                      : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5"
                  )}
                >
                  <span>{label}</span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-md text-[10px]",
                    isActive ? "bg-white/20 text-white" : "bg-black/30 text-slate-400"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}

            {!isHodView && (
              <button
                onClick={() => setActiveCategory('HOD')}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
                  activeCategory === 'HOD'
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                    : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5"
                )}
              >
                HOD / DHOD ({hodStaffList.length})
              </button>
            )}
          </div>

          {/* Export Action */}
          <button
            onClick={handleExportExcel}
            className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Download size={14} />
            Export Category Table
          </button>
        </div>

        {/* Category Summary Header Card */}
        {activeCategory !== 'OVERVIEW' && categoryMetrics[activeCategory] && (
          <div className="bg-gradient-to-r from-blue-900/20 via-slate-800/40 to-blue-900/20 border border-blue-500/20 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                {activeCategory.charAt(0)}
              </div>
              <div>
                <h4 className="font-bold text-white text-sm uppercase">{activeCategory.replace(/_/g, ' ')} Summary</h4>
                <p className="text-slate-400 text-[11px]">
                  Headcount: <strong>{categoryMetrics[activeCategory].headcount}</strong> personnel
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div>
                <span className="text-slate-400">Total Tasks: </span>
                <strong className="text-white">{categoryMetrics[activeCategory].totalTasks}</strong>
              </div>
              <div>
                <span className="text-slate-400">Completed: </span>
                <strong className="text-emerald-400">{categoryMetrics[activeCategory].completed}</strong>
              </div>
              <div>
                <span className="text-slate-400">Running: </span>
                <strong className="text-amber-400">{categoryMetrics[activeCategory].running}</strong>
              </div>
              <div>
                <span className="text-slate-400">Category Perf: </span>
                <strong className="text-blue-400 font-bold">{categoryMetrics[activeCategory].avgPerformance}%</strong>
              </div>
              <div>
                <span className="text-slate-400">Accumulated Points: </span>
                <strong className="text-purple-400 font-bold">{categoryMetrics[activeCategory].totalPoints}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Filter and Search Bar for Table */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-[240px] max-w-md relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
            <input
              type="text"
              placeholder="Search by Name, Employee ID, Designation, Section..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Department Filter */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Dept:</span>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="ALL">All Departments</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {/* Performance Range Filter */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Perf:</span>
              <select
                value={performanceFilter}
                onChange={(e) => setPerformanceFilter(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="ALL">All Performance</option>
                <option value="HIGH">High (≥80%)</option>
                <option value="AVERAGE">Average (50% - 79%)</option>
                <option value="LOW">Low (&lt;50%)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Clean Executive Data Table (Sections 8, 9, 10) */}
        <div className="overflow-x-auto custom-scrollbar border border-white/10 rounded-2xl bg-black/20">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03] text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">Employee ID & Name</th>
                <th className="py-3.5 px-3">Role & Dept</th>
                <th className="py-3.5 px-3">Attendance</th>
                <th className="py-3.5 px-3 text-center">Tasks Given</th>
                <th className="py-3.5 px-3 text-center">Completed</th>
                <th className="py-3.5 px-3 text-center">Running</th>
                <th className="py-3.5 px-3 text-center">Pending</th>
                <th className="py-3.5 px-3 text-center">Hold</th>
                <th className="py-3.5 px-4 text-center">Performance %</th>
                <th className="py-3.5 px-3 text-center">Task Points</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayedStaffList.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-500">
                    No personnel found matching the specified filters for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}.
                  </td>
                </tr>
              ) : (
                displayedStaffList.map(({ person, metrics, attendanceStatus }) => {
                  // Performance badge styling
                  let perfBadgeClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
                  if (metrics.performancePercentage < 50) perfBadgeClass = "bg-red-500/20 text-red-400 border-red-500/30";
                  else if (metrics.performancePercentage < 80) perfBadgeClass = "bg-amber-500/20 text-amber-400 border-amber-500/30";

                  // Attendance badge styling
                  let attClass = "bg-emerald-500/10 text-emerald-400";
                  if (attendanceStatus === 'ABSENT') attClass = "bg-red-500/10 text-red-400";
                  else if (attendanceStatus === 'LEAVE') attClass = "bg-amber-500/10 text-amber-400";
                  else if (attendanceStatus === 'SHORT_LEAVE') attClass = "bg-purple-500/10 text-purple-400";

                  return (
                    <tr 
                      key={person.id}
                      className="hover:bg-white/[0.04] transition-colors group"
                    >
                      {/* Name & ID */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-sm">
                            {person.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-white text-xs truncate group-hover:text-blue-300 transition-colors">
                              {person.name}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              {person.employeeId}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Role & Dept */}
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-200 uppercase text-[11px]">
                          {person.role.replace(/_/g, ' ')}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[130px]">
                          {person.department || person.section || 'General'}
                        </div>
                      </td>

                      {/* Attendance */}
                      <td className="py-3 px-3">
                        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider inline-block", attClass)}>
                          {attendanceStatus}
                        </span>
                      </td>

                      {/* Total Tasks Given */}
                      <td className="py-3 px-3 text-center font-bold text-white">
                        {metrics.totalTasksGiven}
                      </td>

                      {/* Completed */}
                      <td className="py-3 px-3 text-center font-bold text-emerald-400">
                        {metrics.completedTasks}
                      </td>

                      {/* Running */}
                      <td className="py-3 px-3 text-center font-bold text-amber-400">
                        {metrics.runningTasks}
                      </td>

                      {/* Pending */}
                      <td className="py-3 px-3 text-center font-bold text-blue-400">
                        {metrics.pendingTasks}
                      </td>

                      {/* Hold */}
                      <td className="py-3 px-3 text-center font-bold text-red-400">
                        {metrics.holdTasks}
                      </td>

                      {/* Performance % (Section 8 & 9) */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center">
                          <span className={cn("px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border shadow-sm", perfBadgeClass)}>
                            {metrics.performancePercentage}%
                          </span>
                          {/* Mini Progress Bar */}
                          <div className="w-16 h-1 bg-white/10 rounded-full mt-1.5 overflow-hidden">
                            <div 
                              className={cn(
                                "h-full rounded-full transition-all",
                                metrics.performancePercentage >= 80 ? "bg-emerald-400" :
                                metrics.performancePercentage >= 50 ? "bg-amber-400" : "bg-red-400"
                              )} 
                              style={{ width: `${Math.min(metrics.performancePercentage, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Task Points (Individual & Aggregated) */}
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => {
                            setAuditTarget(person);
                            setIsAuditModalOpen(true);
                          }}
                          className="hover:scale-105 transition-transform"
                          title="Click to view full point audit trace"
                        >
                          <div className="font-extrabold text-purple-300 text-xs flex items-center justify-center gap-1">
                            <span>{metrics.totalTaskPoints}</span>
                            <Zap size={11} className="text-purple-400" />
                          </div>
                          {metrics.aggregatedSubordinatePoints > 0 && (
                            <div className="text-[9px] text-slate-400">
                              ({metrics.individualPoints} ind + {metrics.aggregatedSubordinatePoints} agg)
                            </div>
                          )}
                        </button>
                      </td>

                      {/* View Details Action (Section 10) */}
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            setSelectedPerson(person);
                            setIsDetailDrawerOpen(true);
                          }}
                          className="bg-white/5 hover:bg-blue-600 text-slate-300 hover:text-white px-3 py-1.5 rounded-xl font-bold transition-all inline-flex items-center gap-1.5 border border-white/10 hover:border-blue-500 shadow-sm"
                        >
                          <Eye size={12} />
                          <span>View Details</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 10: VIEW DETAILS SIDE DRAWER / DETAIL PANEL                      */}
      {/* ========================================================================= */}
      {isDetailDrawerOpen && selectedPerson && (() => {
        const details = getPersonPeriodMetrics(selectedPerson);
        const personAttendance = attendance.filter(a => a.technicianId === selectedPerson.employeeId);
        const daysPresent = personAttendance.filter(a => a.status === 'PRESENT').length;
        const daysAbsent = personAttendance.filter(a => a.status === 'ABSENT').length;
        const daysLeave = personAttendance.filter(a => a.status === 'LEAVE' || a.status === 'SHORT_LEAVE').length;

        // Supervisor lookup
        const supervisorUser = staffList.find(s => s.id === selectedPerson.supervisorId || s.employeeId === selectedPerson.supervisorId);

        return (
          <div className="fixed inset-0 z-50 overflow-hidden flex justify-end animate-in fade-in duration-200">
            {/* Backdrop */}
            <div 
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setIsDetailDrawerOpen(false)}
            />

            {/* Sliding Panel */}
            <div className="relative w-full max-w-2xl bg-slate-900 border-l border-white/15 h-full shadow-2xl flex flex-col z-10 overflow-hidden">
              {/* Drawer Header */}
              <div className="p-6 bg-gradient-to-r from-slate-900 to-blue-950/70 border-b border-white/10 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-extrabold text-lg shadow-lg shadow-blue-500/20">
                    {selectedPerson.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-extrabold text-white">{selectedPerson.name}</h2>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        {selectedPerson.role.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Employee ID: <span className="font-mono text-white font-bold">{selectedPerson.employeeId}</span> • {selectedPerson.designation || selectedPerson.role}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsDetailDrawerOpen(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                {/* Personnel Information Card */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-white/5 border border-white/10 rounded-2xl p-4 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Department</span>
                    <strong className="text-white text-xs">{selectedPerson.department || 'N/A'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Section</span>
                    <strong className="text-white text-xs">{selectedPerson.section || 'N/A'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Supervisor</span>
                    <strong className="text-white text-xs">{supervisorUser ? `${supervisorUser.name} (${supervisorUser.employeeId})` : 'Executive / Direct'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Contact</span>
                    <span className="text-slate-300 font-mono text-[11px]">{selectedPerson.phone || selectedPerson.email || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Today Status</span>
                    <span className="text-emerald-400 font-bold uppercase">{getPersonTodayAttendance(selectedPerson.employeeId)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Filtered Period</span>
                    <span className="text-blue-300 font-semibold">{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
                  </div>
                </div>

                {/* Period Performance Metrics (Section 8, 9, 10) */}
                <div className="bg-slate-800/40 border border-white/10 rounded-2xl p-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                    Performance Summary ({MONTH_NAMES[selectedMonth - 1]} {selectedYear})
                  </h4>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                    <div className="p-2 rounded-xl bg-white/5">
                      <div className="text-[10px] text-slate-400 uppercase">Total Tasks</div>
                      <div className="text-base font-black text-white">{details.totalTasksGiven}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <div className="text-[10px] text-emerald-400 uppercase">Completed</div>
                      <div className="text-base font-black text-emerald-300">{details.completedTasks}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <div className="text-[10px] text-amber-400 uppercase">Running</div>
                      <div className="text-base font-black text-amber-300">{details.runningTasks}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
                      <div className="text-[10px] text-blue-400 uppercase">Pending</div>
                      <div className="text-base font-black text-blue-300">{details.pendingTasks}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20">
                      <div className="text-[10px] text-red-400 uppercase">Hold</div>
                      <div className="text-base font-black text-red-300">{details.holdTasks}</div>
                    </div>
                    <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
                      <div className="text-[10px] text-purple-400 uppercase">Perf %</div>
                      <div className="text-base font-black text-purple-300">{details.performancePercentage}%</div>
                    </div>
                  </div>

                  {/* Points breakdown */}
                  <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-slate-300">
                    <div>
                      <span>Individual Points: <strong>{details.individualPoints}</strong></span>
                      {details.aggregatedSubordinatePoints > 0 && (
                        <span className="ml-3 text-purple-400">
                          + Aggregated Subordinate: <strong>{details.aggregatedSubordinatePoints}</strong>
                        </span>
                      )}
                    </div>
                    <div className="font-extrabold text-purple-300">
                      Total Points: {details.totalTaskPoints}
                    </div>
                  </div>
                </div>

                {/* Attendance Summary */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    System Attendance Records
                  </h4>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-emerald-400">Days Present: <strong>{daysPresent}</strong></span>
                    <span className="text-red-400">Days Absent: <strong>{daysAbsent}</strong></span>
                    <span className="text-amber-400">Days Leave: <strong>{daysLeave}</strong></span>
                  </div>
                </div>

                {/* Complete Task List in Period (Section 10) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-white">
                      Task History for {MONTH_NAMES[selectedMonth - 1]} {selectedYear} ({details.personTasks.length})
                    </h4>
                    <span className="text-[11px] text-slate-400">Detailed task records</span>
                  </div>

                  {details.personTasks.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs bg-white/5 rounded-2xl border border-white/5">
                      No tasks logged for this person in {MONTH_NAMES[selectedMonth - 1]} {selectedYear}.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {details.personTasks.map(task => {
                        const creatorUser = staffList.find(s => s.employeeId === task.createdBy || s.id === task.createdBy);
                        const isCompleted = task.status === 'COMPLETED';

                        return (
                          <div 
                            key={task.id}
                            className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl p-4 transition-all space-y-3 cursor-pointer"
                            onClick={() => {
                              if (onSelectTask) onSelectTask(task);
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className="font-mono text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded font-bold">
                                    {task.taskId || task.id}
                                  </span>
                                  <span className="text-xs font-bold text-white">{task.title}</span>
                                  <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded font-mono">
                                    {task.model}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-300 line-clamp-2">{task.details}</p>
                              </div>

                              <span className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0",
                                task.status === 'COMPLETED' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
                                task.status === 'RUNNING' ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                                task.status === 'HOLD' ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                                "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                              )}>
                                {task.status}
                              </span>
                            </div>

                            {/* Task Metadata Row */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/5 text-[11px] text-slate-400">
                              <div>
                                <span className="block text-[9px] uppercase font-bold text-slate-500">Creator</span>
                                <span className="text-slate-200 truncate block">
                                  {creatorUser ? `${creatorUser.name} (${creatorUser.employeeId})` : task.createdBy || 'Unknown'}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[9px] uppercase font-bold text-slate-500">Assigned To</span>
                                <span className="text-slate-200 truncate block">
                                  {task.workType === 'TEAM' 
                                    ? `Team (${(task.assignedTechnicians || []).length} Techs)`
                                    : (() => {
                                        const assigneeObj = staffList.find(s => s.id === task.assignedTo || s.employeeId === task.assignedTo || (s.name && task.assignedTo && s.name.toLowerCase().trim() === task.assignedTo.toLowerCase().trim()));
                                        return assigneeObj ? `${assigneeObj.name} (${assigneeObj.employeeId})` : (task.assignedTo || 'Unassigned');
                                      })()}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[9px] uppercase font-bold text-slate-500">Urgency</span>
                                <span className={cn(
                                  "font-bold",
                                  task.urgency === 'MOST_URGENT' ? "text-red-400" :
                                  task.urgency === 'URGENT' ? "text-amber-400" : "text-blue-400"
                                )}>
                                  {task.urgency}
                                </span>
                              </div>
                              <div>
                                <span className="block text-[9px] uppercase font-bold text-slate-500">Points</span>
                                <span className="text-purple-300 font-bold">{task.points || 1} pts</span>
                              </div>
                            </div>

                            {/* Deadline & Timings */}
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400 pt-1">
                              <div>
                                <span>Deadline: <strong className="text-slate-300">{task.deadline || 'No deadline'}</strong></span>
                                {task.completedAt && (
                                  <span className="ml-3 text-emerald-400">
                                    Done: {new Date(task.completedAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                              {task.progress !== undefined && (
                                <div className="text-blue-400 font-bold">
                                  Progress: {task.progress}%
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* POINT AUDIT TRACEABILITY MODAL (Sections 11, 12, 13)                     */}
      {/* ========================================================================= */}
      {isAuditModalOpen && auditTarget && (() => {
        const metrics = getPersonPeriodMetrics(auditTarget);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-purple-500/30 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                    <Award size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Point Audit & Traceability Report</h3>
                    <p className="text-xs text-slate-400">
                      {auditTarget.name} ({auditTarget.employeeId}) • {auditTarget.role}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsAuditModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Individual</span>
                    <span className="text-lg font-black text-white">{metrics.individualPoints} pts</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Subordinate Agg.</span>
                    <span className="text-lg font-black text-purple-400">{metrics.aggregatedSubordinatePoints} pts</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Verified</span>
                    <span className="text-lg font-black text-emerald-400">{metrics.totalTaskPoints} pts</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/20 text-slate-300 space-y-2">
                  <div className="font-bold text-purple-300 flex items-center gap-1.5">
                    <Check size={14} className="text-emerald-400" />
                    <span>No Duplicate Point Rule Active</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Points are not multiplied across hierarchy levels. Every verified point originates from a single completed, approved task. Aggregation provides executive roll-up visibility without inflating the enterprise balance.
                  </p>
                  {auditTarget.role === 'ENGINEER' && (
                    <p className="text-[11px] text-indigo-300 border-t border-purple-500/20 pt-2 mt-2">
                      <strong>Engineer Rule Active:</strong> Includes verified task points generated by supervised Officers assigned tasks by {auditTarget.name}.
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setIsAuditModalOpen(false)}
                  className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs"
                >
                  Close Audit View
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* QUICK ASSIGN TASK TO HOD MODAL (Sections 3 & 15)                          */}
      {/* ========================================================================= */}
      {isAssignHodModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-blue-500/30 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    {isHodView ? "Assign Operational Task to Workforce" : "Assign Executive Task to HOD"}
                  </h3>
                  <p className="text-xs text-slate-400">Direct task assignment from {currentUser.name} ({currentUser.role})</p>
                </div>
              </div>
              <button
                onClick={() => setIsAssignHodModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAssignTaskToHod} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  {isHodView ? "Assign To (In-Charge / Engineer / Officer / Tech) *" : "Assign To (HOD / DCBO) *"}
                </label>
                <select
                  value={hodTaskData.assignedTo}
                  onChange={(e) => setHodTaskData({ ...hodTaskData, assignedTo: e.target.value })}
                  required
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{isHodView ? "Select In-Charge, Officer, or Engineer" : "Select HOD or Executive Assignee"}</option>
                  {isHodView ? (
                    activeStaffList.map(s => (
                      <option key={s.id} value={s.employeeId}>
                        [{s.role.replace(/_/g, ' ')}] {s.name} ({s.employeeId})
                      </option>
                    ))
                  ) : (
                    <>
                      {currentUser.role === 'CBO' && dcboStaffList.map(dcbo => (
                        <option key={dcbo.id} value={dcbo.employeeId}>
                          [DCBO] {dcbo.name} ({dcbo.employeeId})
                        </option>
                      ))}
                      {hodStaffList.map(hod => (
                        <option key={hod.id} value={hod.employeeId}>
                          [{hod.role} - {hod.department || 'Dept'}] {hod.name} ({hod.employeeId})
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1.5">Task Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Monthly Operational Audit & RAC Section Optimization"
                  value={hodTaskData.title}
                  onChange={(e) => setHodTaskData({ ...hodTaskData, title: e.target.value })}
                  required
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1.5">Model / Section</label>
                  <input
                    type="text"
                    value={hodTaskData.model}
                    onChange={(e) => setHodTaskData({ ...hodTaskData, model: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1.5">Urgency</label>
                  <select
                    value={hodTaskData.urgency}
                    onChange={(e) => setHodTaskData({ ...hodTaskData, urgency: e.target.value as any })}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="REGULAR">REGULAR</option>
                    <option value="URGENT">URGENT</option>
                    <option value="MOST_URGENT">MOST URGENT</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1.5">Deadline</label>
                  <input
                    type="date"
                    value={hodTaskData.deadline}
                    onChange={(e) => setHodTaskData({ ...hodTaskData, deadline: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1.5">Estimated Duration</label>
                  <input
                    type="text"
                    value={hodTaskData.estimatedDuration}
                    onChange={(e) => setHodTaskData({ ...hodTaskData, estimatedDuration: e.target.value })}
                    placeholder="e.g. 2 Days, 4 Hours"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1.5">Operational Details / Instructions</label>
                <textarea
                  rows={3}
                  value={hodTaskData.details}
                  onChange={(e) => setHodTaskData({ ...hodTaskData, details: e.target.value })}
                  placeholder="Provide executive guidelines and expectations for this assignment..."
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAssignHodModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTask}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg shadow-blue-500/25 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmittingTask ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      Confirm Assignment
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
