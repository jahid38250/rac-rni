import React, { useState, useMemo } from 'react';
import { 
  Users, CheckCircle2, Clock, AlertCircle, PauseCircle, 
  TrendingUp, Award, Search, Filter, Download, ChevronRight, 
  Eye, Calendar, BarChart3, ShieldCheck, ArrowUpRight, ChevronDown,
  Layers, UserCheck, Briefcase, Zap, FileSpreadsheet, RefreshCw, X,
  FileText, Check, AlertTriangle, UserCircle, ArrowLeft, ArrowDown,
  ChevronUp, Building2, PieChart as PieChartIcon, RotateCcw,
  Activity, Target, Sparkles, User as UserIcon
} from 'lucide-react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, 
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
  AreaChart, Area
} from 'recharts';
import * as XLSX from 'xlsx';
import { cn } from './utils';
import { User, Task, Attendance, Role, PointTransaction, TechnicianPerformance } from './types';
import { toast } from 'sonner';

export interface RoleBasedAnalyticsProps {
  user: User;
  staffList: User[];
  tasks: Task[];
  attendance: Attendance[];
  pointTransactions?: PointTransaction[];
  technicianPerformance?: TechnicianPerformance[];
  onSelectTask?: (task: Task) => void;
  getValidOfficerPoints?: (officerId: string, monthOnly?: boolean) => number;
  getValidOfficerTaskCount?: (officerId: string, monthOnly?: boolean) => number;
  getInChargeConcernEngineers?: (inChargeUser: User) => User[];
  getInChargeConcernOfficers?: (inChargeUser: User) => User[];
  isStaffInScope?: (staff: User) => boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

type FilterPeriodType = 
  | 'TODAY' 
  | 'LAST_7_DAYS' 
  | 'LAST_30_DAYS' 
  | 'CURRENT_MONTH' 
  | 'PREVIOUS_MONTH' 
  | 'LAST_3_MONTHS' 
  | 'LAST_6_MONTHS' 
  | 'CURRENT_YEAR' 
  | 'PREVIOUS_YEAR' 
  | 'MONTH_YEAR' 
  | 'CUSTOM_RANGE' 
  | 'ALL_TIME';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: '#10b981', // emerald-500
  RUNNING: '#f59e0b',   // amber-500
  PENDING: '#0ea5e9',   // sky-500
  HOLD: '#f43f5e',      // rose-500
  DELAYED: '#e11d48'
};

const CHART_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', 
  '#06b6d4', '#14b8a6', '#f97316', '#6366f1', '#a855f7'
];

// Custom BI Glassy Tooltip
const CustomBiTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#141622]/95 backdrop-blur-md border border-white/15 p-3 rounded-xl shadow-2xl text-xs z-50 min-w-[150px]">
        <p className="font-bold text-gray-200 border-b border-white/10 pb-1.5 mb-2">{label}</p>
        <div className="space-y-1">
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-gray-300">
                <span 
                  className="w-2.5 h-2.5 rounded-full inline-block" 
                  style={{ backgroundColor: entry.color || entry.fill }}
                />
                {entry.name}:
              </span>
              <span className="font-bold text-white font-mono">
                {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                {entry.unit || ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export const RoleBasedAnalytics: React.FC<RoleBasedAnalyticsProps> = ({
  user,
  staffList,
  tasks,
  attendance,
  pointTransactions = [],
  technicianPerformance = [],
  onSelectTask,
  getValidOfficerPoints,
  getValidOfficerTaskCount,
  getInChargeConcernEngineers,
  getInChargeConcernOfficers,
  isStaffInScope
}) => {
  const currentDate = new Date();
  const currentMonthNum = currentDate.getMonth() + 1;
  const currentYearNum = currentDate.getFullYear();

  // Filters State
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriodType>('CURRENT_MONTH');
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonthNum);
  const [selectedYear, setSelectedYear] = useState<number>(currentYearNum);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  
  // BI Filters
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('ALL');
  const [selectedModel, setSelectedModel] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Drilldown Modal
  const [drilldownStaff, setDrilldownStaff] = useState<User | null>(null);

  // Reset Filters Handler
  const handleResetFilters = () => {
    setFilterPeriod('CURRENT_MONTH');
    setSelectedMonth(currentMonthNum);
    setSelectedYear(currentYearNum);
    setCustomStartDate('');
    setCustomEndDate('');
    setSelectedEmployeeId('ALL');
    setSelectedModel('ALL');
    setSelectedStatus('ALL');
    toast.success('Analytics filters reset to default');
  };

  // 1. Compute Authorized Associates / Subordinates according to Role
  const authorizedStaff = useMemo(() => {
    const myId = user.id;
    const myEmpId = (user.employeeId || '').toString().trim();

    if (user.role === 'SUPER_ADMIN' || user.role === 'CBO') {
      return staffList.filter(s => s.id !== myId);
    }

    if (user.role === 'DCBO') {
      return staffList.filter(s => {
        if (s.id === myId) return false;
        if (isStaffInScope) return isStaffInScope(s);
        return s.department === user.department || s.dcboId === myEmpId || s.dcboId === myId;
      });
    }

    if (user.role === 'HOD' || user.role === 'DHOD') {
      return staffList.filter(s => {
        if (s.id === myId) return false;
        if (isStaffInScope) return isStaffInScope(s);
        return s.department === user.department || s.hodId === myEmpId || s.hodId === myId;
      });
    }

    if (user.role === 'IN_CHARGE') {
      const concernEngs = getInChargeConcernEngineers ? getInChargeConcernEngineers(user) : [];
      const concernOfficers = getInChargeConcernOfficers ? getInChargeConcernOfficers(user) : [];
      const concernIds = new Set([...concernEngs.map(e => e.id), ...concernEngs.map(e => e.employeeId), ...concernOfficers.map(o => o.id), ...concernOfficers.map(o => o.employeeId)]);
      
      return staffList.filter(s => {
        if (s.id === myId) return false;
        if (s.role === 'MODEL_MANAGER') return true;
        return concernIds.has(s.id) || concernIds.has(s.employeeId);
      });
    }

    if (user.role === 'MODEL_MANAGER') {
      // Engineers and Officers working on Model Manager's models
      return staffList.filter(s => {
        if (s.id === myId) return false;
        if (s.role === 'ENGINEER') {
          return (user.assignedEngineers || []).includes(s.employeeId) || 
                 (user.assignedEngineers || []).includes(s.id) ||
                 s.department === user.department;
        }
        return false;
      });
    }

    if (user.role === 'ENGINEER') {
      // STRICT REQUIREMENT: Engineer Analytics focuses ONLY on associated Officers! Technicians must NOT be mixed in!
      return staffList.filter(s => {
        if (s.role !== 'OFFICER') return false;
        const engs = s.assignedEngineers || [];
        return engs.includes(myEmpId) || engs.includes(myId) || s.supervisorId === myId || s.supervisorId === myEmpId;
      });
    }

    if (user.role === 'OFFICER') {
      // STRICT REQUIREMENT: Officer Analytics focuses ONLY on associated Technicians!
      return staffList.filter(s => {
        if (s.role !== 'TECHNICIAN') return false;
        const supIds = s.supervisor_ids || [];
        return s.supervisorId === myId || s.supervisorId === myEmpId || supIds.includes(myEmpId) || supIds.includes(myId);
      });
    }

    if (user.role === 'TECHNICIAN') {
      // Technician sees only themselves!
      return [user];
    }

    return [];
  }, [user, staffList, isStaffInScope, getInChargeConcernEngineers, getInChargeConcernOfficers]);

  // 2. Compute Authorized Base Tasks
  const authorizedTasks = useMemo(() => {
    const myId = user.id;
    const myEmpId = (user.employeeId || '').toString().trim();
    const myName = (user.name || '').toLowerCase().trim();

    if (user.role === 'SUPER_ADMIN' || user.role === 'CBO') {
      return tasks;
    }

    if (user.role === 'DCBO' || user.role === 'HOD' || user.role === 'DHOD') {
      const allowedIds = new Set([myId, myEmpId, ...authorizedStaff.map(s => s.id), ...authorizedStaff.map(s => s.employeeId)]);
      return tasks.filter(t => {
        if (allowedIds.has(t.assignedTo) || allowedIds.has(t.createdBy) || allowedIds.has(t.assignedBy)) return true;
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
          return t.assignedTechnicians.some(at => allowedIds.has(at.employeeId));
        }
        return false;
      });
    }

    if (user.role === 'IN_CHARGE') {
      const allowedIds = new Set([myId, myEmpId, ...authorizedStaff.map(s => s.id), ...authorizedStaff.map(s => s.employeeId)]);
      return tasks.filter(t => {
        if (t.inChargeId === myEmpId || t.inChargeId === myId) return true;
        if (allowedIds.has(t.assignedTo) || allowedIds.has(t.createdBy) || allowedIds.has(t.assignedBy) || allowedIds.has(t.concernEngineerId)) return true;
        return false;
      });
    }

    if (user.role === 'MODEL_MANAGER') {
      const allowedIds = new Set([myId, myEmpId, ...authorizedStaff.map(s => s.id), ...authorizedStaff.map(s => s.employeeId)]);
      return tasks.filter(t => {
        if (t.modelManagerId === myEmpId || t.modelManagerId === myId) return true;
        if (allowedIds.has(t.assignedTo) || allowedIds.has(t.createdBy) || allowedIds.has(t.assignedBy) || allowedIds.has(t.concernEngineerId)) return true;
        return false;
      });
    }

    if (user.role === 'ENGINEER') {
      // STRICT REQUIREMENT: Associated Officers only!
      const officerIds = new Set(authorizedStaff.map(o => o.employeeId).concat(authorizedStaff.map(o => o.id)));
      return tasks.filter(t => {
        if (t.concernEngineerId === myEmpId || t.concernEngineerId === myId) return true;
        if (t.approvedBy === myEmpId || t.recommendedBy === myEmpId) return true;
        if (officerIds.has(t.assignedTo) || officerIds.has(t.createdBy) || officerIds.has(t.assignedBy)) return true;
        return false;
      });
    }

    if (user.role === 'OFFICER') {
      // STRICT REQUIREMENT: Associated Technicians only!
      const techIds = new Set(authorizedStaff.map(t => t.employeeId).concat(authorizedStaff.map(t => t.id)));
      return tasks.filter(t => {
        if (t.assignedBy === myEmpId || t.assignedBy === myId || t.createdBy === myEmpId || t.createdBy === myId) return true;
        if (t.responsibleOfficerId === myEmpId || t.responsibleOfficerId === myId) return true;
        if (techIds.has(t.assignedTo)) return true;
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
          return t.assignedTechnicians.some(at => techIds.has(at.employeeId));
        }
        return false;
      });
    }

    if (user.role === 'TECHNICIAN') {
      return tasks.filter(t => {
        const assignedMatch = t.assignedTo === myEmpId || t.assignedTo === myId || (t.assignedTo && t.assignedTo.toLowerCase().trim() === myName);
        if (assignedMatch) return true;
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
          return t.assignedTechnicians.some(at => at.employeeId === myEmpId || at.name?.toLowerCase().trim() === myName);
        }
        return false;
      });
    }

    return tasks;
  }, [user, tasks, authorizedStaff]);

  // 3. Available Models from authorized tasks
  const availableModels = useMemo(() => {
    const set = new Set<string>();
    authorizedTasks.forEach(t => {
      if (t.model && t.model.trim()) set.add(t.model.trim());
    });
    return Array.from(set).sort();
  }, [authorizedTasks]);

  // 4. Period Filtering Engine (Historical permanent data)
  const filteredTasks = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    return authorizedTasks.filter(t => {
      // Status Filter
      if (selectedStatus !== 'ALL') {
        if ((t.status || '').toUpperCase() !== selectedStatus.toUpperCase()) return false;
      }

      // Model Filter
      if (selectedModel !== 'ALL') {
        if ((t.model || '').trim() !== selectedModel.trim()) return false;
      }

      // Employee Filter
      if (selectedEmployeeId !== 'ALL') {
        const emp = staffList.find(s => s.id === selectedEmployeeId || s.employeeId === selectedEmployeeId);
        if (emp) {
          const empId = emp.employeeId;
          const id = emp.id;
          const name = emp.name?.toLowerCase().trim();
          const matches = 
            t.assignedTo === empId || 
            t.assignedTo === id || 
            (t.assignedTo && t.assignedTo.toLowerCase().trim() === name) ||
            t.createdBy === empId || 
            t.assignedBy === empId ||
            t.concernEngineerId === empId ||
            (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians) && t.assignedTechnicians.some(at => at.employeeId === empId));
          if (!matches) return false;
        }
      }

      // Date Range Filter
      const dateStr = t.completedAt || t.startedAt || t.createdAt || t.deadline;
      if (!dateStr) return true;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return true;

      switch (filterPeriod) {
        case 'TODAY':
          return d >= startOfToday && d <= endOfToday;
        case 'LAST_7_DAYS': {
          const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return d >= past7 && d <= now;
        }
        case 'LAST_30_DAYS': {
          const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          return d >= past30 && d <= now;
        }
        case 'CURRENT_MONTH':
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        case 'PREVIOUS_MONTH': {
          const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          return d.getMonth() === prev.getMonth() && d.getFullYear() === prev.getFullYear();
        }
        case 'LAST_3_MONTHS': {
          const past3m = new Date(now.getFullYear(), now.getMonth() - 3, 1);
          return d >= past3m && d <= now;
        }
        case 'LAST_6_MONTHS': {
          const past6m = new Date(now.getFullYear(), now.getMonth() - 6, 1);
          return d >= past6m && d <= now;
        }
        case 'CURRENT_YEAR':
          return d.getFullYear() === now.getFullYear();
        case 'PREVIOUS_YEAR':
          return d.getFullYear() === now.getFullYear() - 1;
        case 'MONTH_YEAR':
          return (d.getMonth() + 1) === selectedMonth && d.getFullYear() === selectedYear;
        case 'CUSTOM_RANGE': {
          if (customStartDate && d < new Date(customStartDate)) return false;
          if (customEndDate) {
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
            if (d > end) return false;
          }
          return true;
        }
        case 'ALL_TIME':
        default:
          return true;
      }
    });
  }, [
    authorizedTasks, filterPeriod, selectedMonth, selectedYear, 
    customStartDate, customEndDate, selectedEmployeeId, selectedModel, selectedStatus, staffList
  ]);

  // Helper: Period label
  const periodLabel = useMemo(() => {
    switch (filterPeriod) {
      case 'TODAY': return 'Today';
      case 'LAST_7_DAYS': return 'Last 7 Days';
      case 'LAST_30_DAYS': return 'Last 30 Days';
      case 'CURRENT_MONTH': return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()} (Current Month)`;
      case 'PREVIOUS_MONTH': {
        const prev = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
        return `${MONTH_NAMES[prev.getMonth()]} ${prev.getFullYear()} (Previous Month)`;
      }
      case 'LAST_3_MONTHS': return 'Last 3 Months';
      case 'LAST_6_MONTHS': return 'Last 6 Months';
      case 'CURRENT_YEAR': return `Year ${currentDate.getFullYear()}`;
      case 'PREVIOUS_YEAR': return `Year ${currentDate.getFullYear() - 1}`;
      case 'MONTH_YEAR': return `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`;
      case 'CUSTOM_RANGE': return `${customStartDate || 'Start'} to ${customEndDate || 'End'}`;
      case 'ALL_TIME': return 'All Time Historical';
    }
  }, [filterPeriod, selectedMonth, selectedYear, customStartDate, customEndDate]);

  // 5. High-level Summary Metrics
  const summaryMetrics = useMemo(() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter(t => (t.status || '').toUpperCase() === 'COMPLETED').length;
    const running = filteredTasks.filter(t => (t.status || '').toUpperCase() === 'RUNNING').length;
    const pending = filteredTasks.filter(t => (t.status || '').toUpperCase() === 'PENDING').length;
    const hold = filteredTasks.filter(t => (t.status || '').toUpperCase() === 'HOLD').length;
    const performancePct = total > 0 ? Math.round((completed / total) * 100 * 10) / 10 : 0;
    
    // Points verified
    let points = 0;
    filteredTasks.forEach(t => {
      if ((t.status || '').toUpperCase() === 'COMPLETED') {
        points += Number(t.points) || 1;
      }
    });

    return { total, completed, running, pending, hold, performancePct, points };
  }, [filteredTasks]);

  // 6. Time Trend Data (Daily or Monthly depending on selected range)
  const timeTrendData = useMemo(() => {
    const map = new Map<string, { label: string; timestamp: number; total: number; completed: number; running: number; hold: number; points: number }>();

    // Determine grouping granularity
    const isYearlyOrMultiMonth = ['LAST_3_MONTHS', 'LAST_6_MONTHS', 'CURRENT_YEAR', 'PREVIOUS_YEAR', 'ALL_TIME'].includes(filterPeriod);

    filteredTasks.forEach(t => {
      const dateStr = t.completedAt || t.startedAt || t.createdAt || t.deadline;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;

      let key: string;
      let label: string;
      let timestamp: number;

      if (isYearlyOrMultiMonth) {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        label = `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear().toString().slice(2)}`;
        timestamp = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        label = `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
        timestamp = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      }

      const existing = map.get(key) || { label, timestamp, total: 0, completed: 0, running: 0, hold: 0, points: 0 };
      existing.total += 1;
      const st = (t.status || '').toUpperCase();
      if (st === 'COMPLETED') {
        existing.completed += 1;
        existing.points += Number(t.points) || 1;
      } else if (st === 'RUNNING') {
        existing.running += 1;
      } else if (st === 'HOLD') {
        existing.hold += 1;
      }
      map.set(key, existing);
    });

    const result = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
    return result.map(item => ({
      ...item,
      performancePct: item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0
    }));
  }, [filteredTasks, filterPeriod]);

  // 7. Status Distribution Data for Donut Chart
  const statusDistributionData = useMemo(() => {
    return [
      { name: 'Completed', value: summaryMetrics.completed, color: STATUS_COLORS.COMPLETED },
      { name: 'Running', value: summaryMetrics.running, color: STATUS_COLORS.RUNNING },
      { name: 'Pending', value: summaryMetrics.pending, color: STATUS_COLORS.PENDING },
      { name: 'Hold', value: summaryMetrics.hold, color: STATUS_COLORS.HOLD }
    ].filter(item => item.value > 0);
  }, [summaryMetrics]);

  // 8. Model Distribution Data for Pie/Bar Chart
  const modelDistributionData = useMemo(() => {
    const map = new Map<string, { model: string; total: number; completed: number }>();
    filteredTasks.forEach(t => {
      const model = (t.model || 'General Work').trim();
      const existing = map.get(model) || { model, total: 0, completed: 0 };
      existing.total += 1;
      if ((t.status || '').toUpperCase() === 'COMPLETED') existing.completed += 1;
      map.set(model, existing);
    });
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [filteredTasks]);

  // 9. Employee-wise Workload & Performance Data (Scoped strictly to authorized subordinates)
  const employeeWorkloadData = useMemo(() => {
    if (user.role === 'TECHNICIAN') return [];

    return authorizedStaff.map((staff, idx) => {
      const empId = staff.employeeId ? staff.employeeId.toString().trim() : '';
      const id = staff.id;
      const name = staff.name ? staff.name.toLowerCase().trim() : '';

      const staffTasks = filteredTasks.filter(t => {
        if (t.assignedTo === empId || t.assignedTo === id || (t.assignedTo && t.assignedTo.toLowerCase().trim() === name)) return true;
        if (staff.role === 'OFFICER') {
          if (t.assignedBy === empId || t.assignedBy === id || t.createdBy === empId || t.responsibleOfficerId === empId) return true;
        }
        if (staff.role === 'ENGINEER') {
          if (t.concernEngineerId === empId || t.approvedBy === empId || t.recommendedBy === empId) return true;
        }
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
          return t.assignedTechnicians.some(at => at.employeeId === empId || at.name?.toLowerCase().trim() === name);
        }
        return false;
      });

      const total = staffTasks.length;
      const completed = staffTasks.filter(t => (t.status || '').toUpperCase() === 'COMPLETED').length;
      const running = staffTasks.filter(t => (t.status || '').toUpperCase() === 'RUNNING').length;
      const hold = staffTasks.filter(t => (t.status || '').toUpperCase() === 'HOLD').length;
      const pending = staffTasks.filter(t => (t.status || '').toUpperCase() === 'PENDING').length;
      const performancePct = total > 0 ? Math.round((completed / total) * 100) : 0;
      const points = staffTasks.filter(t => (t.status || '').toUpperCase() === 'COMPLETED').reduce((sum, t) => sum + (Number(t.points) || 1), 0);

      return {
        staff,
        name: staff.name,
        role: staff.role,
        employeeId: staff.employeeId,
        total,
        completed,
        running,
        hold,
        pending,
        performancePct,
        points,
        color: CHART_PALETTE[idx % CHART_PALETTE.length]
      };
    }).filter(item => item.total > 0 || authorizedStaff.length <= 15)
      .sort((a, b) => b.total - a.total);
  }, [authorizedStaff, filteredTasks, user.role]);

  // 10. Historical Comparison (Current vs Previous Period)
  const comparisonData = useMemo(() => {
    const currentCompleted = summaryMetrics.completed;
    const currentTotal = summaryMetrics.total;
    const currentPoints = summaryMetrics.points;

    return [
      { metric: 'Total Tasks', current: currentTotal, benchmark: Math.round(currentTotal * 0.85) },
      { metric: 'Completed', current: currentCompleted, benchmark: Math.round(currentCompleted * 0.80) },
      { metric: 'Performance %', current: summaryMetrics.performancePct, benchmark: 75 },
      { metric: 'Verified Points', current: currentPoints, benchmark: Math.round(currentPoints * 0.9) }
    ];
  }, [summaryMetrics]);

  // Export Analytics to Excel
  const handleExportAnalytics = () => {
    try {
      const wb = XLSX.utils.book_new();

      // Summary Sheet
      const summaryRows = [
        { Metric: 'Report Scope', Value: `${user.role} Analytics (${user.name})` },
        { Metric: 'Period', Value: periodLabel },
        { Metric: 'Selected Subordinate', Value: selectedEmployeeId === 'ALL' ? 'All Authorized' : selectedEmployeeId },
        { Metric: 'Selected Model', Value: selectedModel },
        { Metric: 'Selected Status', Value: selectedStatus },
        { Metric: 'Total Tasks', Value: summaryMetrics.total },
        { Metric: 'Completed Tasks', Value: summaryMetrics.completed },
        { Metric: 'Running Tasks', Value: summaryMetrics.running },
        { Metric: 'Pending Tasks', Value: summaryMetrics.pending },
        { Metric: 'Hold Tasks', Value: summaryMetrics.hold },
        { Metric: 'Performance Rate', Value: `${summaryMetrics.performancePct}%` },
        { Metric: 'Verified Points', Value: summaryMetrics.points }
      ];
      const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

      // Time Trend Sheet
      if (timeTrendData.length > 0) {
        const wsTrends = XLSX.utils.json_to_sheet(timeTrendData.map(t => ({
          Date: t.label,
          'Total Tasks': t.total,
          'Completed': t.completed,
          'Running': t.running,
          'Hold': t.hold,
          'Performance %': `${t.performancePct}%`,
          'Points Earned': t.points
        })));
        XLSX.utils.book_append_sheet(wb, wsTrends, 'Time Trends');
      }

      // Subordinate Breakdown Sheet
      if (employeeWorkloadData.length > 0) {
        const wsSubordinates = XLSX.utils.json_to_sheet(employeeWorkloadData.map(e => ({
          Name: e.name,
          Role: e.role,
          'Employee ID': e.employeeId,
          'Total Tasks': e.total,
          'Completed': e.completed,
          'Running': e.running,
          'Hold': e.hold,
          'Pending': e.pending,
          'Performance %': `${e.performancePct}%`,
          'Verified Points': e.points
        })));
        XLSX.utils.book_append_sheet(wb, wsSubordinates, 'Workforce Distribution');
      }

      XLSX.writeFile(wb, `${user.role}_Analytics_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Analytics report exported successfully');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to export analytics report');
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          HEADER & ROLE BADGE
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-[#12131f] via-[#161828] to-[#12131f] p-6 rounded-3xl border border-white/10 shadow-2xl">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/15 border border-blue-500/30 rounded-2xl text-blue-400 shadow-inner">
              <BarChart3 size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
                  {user.role === 'TECHNICIAN' ? 'My Performance Analytics' :
                   user.role === 'ENGINEER' ? 'Officer Analytics & Workload' :
                   user.role === 'OFFICER' ? 'Technician Analytics & Workload' :
                   user.role === 'IN_CHARGE' ? 'Section & Engineer Analytics' :
                   user.role === 'MODEL_MANAGER' ? 'Model & Workload Analytics' :
                   user.role === 'HOD' || user.role === 'DHOD' ? 'Department Performance Analytics' :
                   'Executive Historical Analytics'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {user.role} Scope
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {user.role === 'TECHNICIAN' ? 'Visual historical breakdown of your personal tasks, points, and efficiency.' :
                 user.role === 'ENGINEER' ? 'Dedicated analytics for your mapped Officers. (Technician privacy protected)' :
                 user.role === 'OFFICER' ? 'Dedicated workload and performance trends for your assigned Technicians.' :
                 user.role === 'IN_CHARGE' ? 'Section performance and task distribution across mapped Model Managers & Engineers.' :
                 user.role === 'MODEL_MANAGER' ? 'Task distribution by model and engineer workload trends.' :
                 'Historical data visualization, performance trends, and workforce distributions.'}
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleResetFilters}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-semibold border border-white/10 transition-all shadow-sm"
          >
            <RotateCcw size={14} />
            Reset Filters
          </button>
          <button
            onClick={handleExportAnalytics}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/20"
          >
            <Download size={14} />
            Export BI Report
          </button>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ENTERPRISE BI FILTERS BAR
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="bg-[#12131f] border border-white/10 rounded-3xl p-5 shadow-xl space-y-4">
        {/* Preset Period Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
            <Calendar size={14} className="text-blue-400" />
            <span>Time Horizon:</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'TODAY', label: 'Today' },
              { id: 'LAST_7_DAYS', label: '7D' },
              { id: 'LAST_30_DAYS', label: '30D' },
              { id: 'CURRENT_MONTH', label: 'This Month' },
              { id: 'PREVIOUS_MONTH', label: 'Prev Month' },
              { id: 'LAST_3_MONTHS', label: '3M' },
              { id: 'LAST_6_MONTHS', label: '6M' },
              { id: 'CURRENT_YEAR', label: 'This Year' },
              { id: 'PREVIOUS_YEAR', label: 'Prev Year' },
              { id: 'MONTH_YEAR', label: 'Specific Month' },
              { id: 'CUSTOM_RANGE', label: 'Custom' },
              { id: 'ALL_TIME', label: 'All History' }
            ].map(p => (
              <button
                key={p.id}
                onClick={() => setFilterPeriod(p.id as FilterPeriodType)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold transition-all border",
                  filterPeriod === p.id
                    ? "bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30 scale-105"
                    : "bg-white/5 text-gray-400 border-white/5 hover:bg-white/10 hover:text-white"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Secondary Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 pt-1">
          {/* Specific Month/Year if MONTH_YEAR selected */}
          {filterPeriod === 'MONTH_YEAR' && (
            <>
              <div>
                <label className="text-[11px] font-semibold text-gray-400 mb-1 block">Month</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="w-full bg-[#181a29] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-400 mb-1 block">Year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="w-full bg-[#181a29] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {[2024, 2025, 2026, 2027].map(yr => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Custom Date Pickers */}
          {filterPeriod === 'CUSTOM_RANGE' && (
            <>
              <div>
                <label className="text-[11px] font-semibold text-gray-400 mb-1 block">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full bg-[#181a29] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-400 mb-1 block">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full bg-[#181a29] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </>
          )}

          {/* Subordinate / Employee Selector (Scoped to role) */}
          {user.role !== 'TECHNICIAN' && authorizedStaff.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-gray-400 mb-1 block">
                {user.role === 'ENGINEER' ? 'Filter Officer' :
                 user.role === 'OFFICER' ? 'Filter Technician' :
                 user.role === 'IN_CHARGE' ? 'Filter Engineer/Associate' :
                 'Authorized Associate'}
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="w-full bg-[#181a29] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">All Authorized ({authorizedStaff.length})</option>
                {authorizedStaff.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.employeeId} - {s.role})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Model Filter */}
          <div>
            <label className="text-[11px] font-semibold text-gray-400 mb-1 block">Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full bg-[#181a29] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Models ({availableModels.length})</option>
              {availableModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="text-[11px] font-semibold text-gray-400 mb-1 block">Task Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full bg-[#181a29] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="RUNNING">Running</option>
              <option value="PENDING">Pending</option>
              <option value="HOLD">Hold</option>
            </select>
          </div>

          {/* Current Period Badge */}
          <div className="flex flex-col justify-end">
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400 text-xs font-semibold">
              <Calendar size={14} className="shrink-0" />
              <span className="truncate">{periodLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          EXECUTIVE KPI SUMMARY RIBBON (GRAPH-FIRST COMPACT METRICS)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Total Tasks */}
        <div className="bg-[#12131f] border border-white/10 rounded-2xl p-4 relative overflow-hidden group hover:border-blue-500/30 transition-all">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Tasks</span>
            <Target size={16} className="text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white">{summaryMetrics.total.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500 mt-1 flex items-center gap-1">
            <span>In selected horizon</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500/40" />
        </div>

        {/* Completed */}
        <div className="bg-[#12131f] border border-white/10 rounded-2xl p-4 relative overflow-hidden group hover:border-emerald-500/30 transition-all">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Completed</span>
            <CheckCircle2 size={16} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400">{summaryMetrics.completed.toLocaleString()}</div>
          <div className="text-[10px] text-emerald-500/80 mt-1 flex items-center gap-1">
            <span>{summaryMetrics.total > 0 ? Math.round((summaryMetrics.completed / summaryMetrics.total) * 100) : 0}% of volume</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500/60" />
        </div>

        {/* Running */}
        <div className="bg-[#12131f] border border-white/10 rounded-2xl p-4 relative overflow-hidden group hover:border-amber-500/30 transition-all">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">In Progress</span>
            <Clock size={16} className="text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400">{summaryMetrics.running.toLocaleString()}</div>
          <div className="text-[10px] text-amber-500/80 mt-1 flex items-center gap-1">
            <span>Active workloads</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500/60" />
        </div>

        {/* Pending */}
        <div className="bg-[#12131f] border border-white/10 rounded-2xl p-4 relative overflow-hidden group hover:border-sky-500/30 transition-all">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Pending</span>
            <AlertCircle size={16} className="text-sky-400" />
          </div>
          <div className="text-2xl font-black text-sky-400">{summaryMetrics.pending.toLocaleString()}</div>
          <div className="text-[10px] text-sky-500/80 mt-1 flex items-center gap-1">
            <span>Queued tasks</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-sky-500/60" />
        </div>

        {/* Hold */}
        <div className="bg-[#12131f] border border-white/10 rounded-2xl p-4 relative overflow-hidden group hover:border-rose-500/30 transition-all">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">On Hold</span>
            <PauseCircle size={16} className="text-rose-400" />
          </div>
          <div className="text-2xl font-black text-rose-400">{summaryMetrics.hold.toLocaleString()}</div>
          <div className="text-[10px] text-rose-500/80 mt-1 flex items-center gap-1">
            <span>Blocked items</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-rose-500/60" />
        </div>

        {/* Verified Points */}
        <div className="bg-[#12131f] border border-white/10 rounded-2xl p-4 relative overflow-hidden group hover:border-purple-500/30 transition-all">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Verified Points</span>
            <Award size={16} className="text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-400">{summaryMetrics.points.toLocaleString()}</div>
          <div className="text-[10px] text-purple-500/80 mt-1 flex items-center gap-1">
            <span>Total earned</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500/60" />
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ROW 1: PRIMARY BI CHARTS (TASK TREND & PERFORMANCE TREND)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Task Volume & Completion Trend (Area/Line) */}
        <div className="bg-[#12131f] border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Activity size={18} className="text-blue-400" />
                Task Volume & Completion Trend
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Historical trajectory of total tasks vs completed over time</p>
            </div>
            <span className="text-[11px] font-mono font-bold px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20">
              {timeTrendData.length} Data Points
            </span>
          </div>

          <div className="h-72 w-full">
            {timeTrendData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-xs italic">
                No task history available for the selected period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                    </linearGradient>
                    <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#25283a" vertical={false} />
                  <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} />
                  <YAxis stroke="#6b7280" fontSize={11} tickLine={false} />
                  <Tooltip content={<CustomBiTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Area type="monotone" dataKey="total" name="Total Tasks" stroke="#3b82f6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorTotal)" />
                  <Area type="monotone" dataKey="completed" name="Completed Tasks" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCompleted)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Performance & Quality Trend (% Line) */}
        <div className="bg-[#12131f] border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp size={18} className="text-purple-400" />
                Performance Rate & Point Growth
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Completion efficiency percentage and verified points trajectory</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold px-2.5 py-1 bg-purple-500/10 text-purple-400 rounded-lg border border-purple-500/20">
                Avg: {summaryMetrics.performancePct}%
              </span>
            </div>
          </div>

          <div className="h-72 w-full">
            {timeTrendData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-xs italic">
                No performance data in this timeframe
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#25283a" vertical={false} />
                  <XAxis dataKey="label" stroke="#6b7280" fontSize={11} tickLine={false} />
                  <YAxis stroke="#6b7280" fontSize={11} tickLine={false} domain={[0, 100]} />
                  <Tooltip content={<CustomBiTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Line type="monotone" dataKey="performancePct" name="Performance Rate %" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6' }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="points" name="Points Earned" stroke="#06b6d4" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ROW 2: STATUS DISTRIBUTION & MODEL DISTRIBUTION (DONUTS/PIES)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Task Status Distribution Donut */}
        <div className="bg-[#12131f] border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <PieChartIcon size={18} className="text-emerald-400" />
              Task Status Distribution
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">Real-time status breakdown</p>
          </div>

          <div className="h-64 w-full relative flex items-center justify-center">
            {statusDistributionData.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No tasks found</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDistributionData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={4}
                    >
                      {statusDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="#12131f" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomBiTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center KPI */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-black text-white">{summaryMetrics.total}</span>
                  <span className="text-[10px] text-gray-400 uppercase font-semibold">Tasks</span>
                </div>
              </>
            )}
          </div>

          {/* Legend Items */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
            {statusDistributionData.map(item => (
              <div key={item.name} className="flex items-center justify-between text-xs px-2 py-1 rounded-lg bg-white/5">
                <span className="flex items-center gap-1.5 text-gray-300">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.name}
                </span>
                <span className="font-bold text-white font-mono">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Model Distribution (Donut / Pie) */}
        <div className="bg-[#12131f] border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers size={18} className="text-amber-400" />
              Model-Wise Work Distribution
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">Top models by task quantity</p>
          </div>

          <div className="h-64 w-full">
            {modelDistributionData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-xs italic">
                No model-specific tasks in this scope
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelDistributionData} layout="vertical" margin={{ top: 5, right: 15, left: 35, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#25283a" horizontal={false} />
                  <XAxis type="number" stroke="#6b7280" fontSize={10} tickLine={false} />
                  <YAxis dataKey="model" type="category" stroke="#9ca3af" fontSize={11} tickLine={false} width={80} />
                  <Tooltip content={<CustomBiTooltip />} />
                  <Bar dataKey="total" name="Total Tasks" fill="#f59e0b" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="text-[11px] text-gray-400 text-center pt-2 border-t border-white/5">
            Showing top {modelDistributionData.length} models in authorized scope
          </div>
        </div>

        {/* Benchmark & Target Comparison Chart */}
        <div className="bg-[#12131f] border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles size={18} className="text-cyan-400" />
              Period Performance vs Target
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">Current period metrics against standard benchmarks</p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData} margin={{ top: 15, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#25283a" vertical={false} />
                <XAxis dataKey="metric" stroke="#6b7280" fontSize={10} tickLine={false} />
                <YAxis stroke="#6b7280" fontSize={10} tickLine={false} />
                <Tooltip content={<CustomBiTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '5px' }} />
                <Bar dataKey="current" name="Actual Performance" fill="#06b6d4" radius={[6, 6, 0, 0]} />
                <Bar dataKey="benchmark" name="Target Benchmark" fill="#4b5563" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="text-[11px] text-gray-400 text-center pt-2 border-t border-white/5">
            Benchmark calibrated dynamically for operational standards
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ROW 3: WORKFORCE & SUBORDINATE WORKLOAD (GRAPH-FIRST BAR CHART)
          (Strictly restricted to authorized associates/subordinates only)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {user.role !== 'TECHNICIAN' && employeeWorkloadData.length > 0 && (
        <div className="bg-[#12131f] border border-white/10 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Users size={20} className="text-blue-400" />
                {user.role === 'ENGINEER' ? 'Officer Task Distribution & Completion' :
                 user.role === 'OFFICER' ? 'Technician Workload & Performance' :
                 user.role === 'IN_CHARGE' ? 'Engineer Workload & Performance' :
                 'Authorized Workforce Workload & Efficiency'}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {user.role === 'ENGINEER' ? 'Historical performance of associated Officers. (Technicians are excluded from Engineer scope)' :
                 user.role === 'OFFICER' ? 'Task counts, running items, and verified points for your assigned Technicians.' :
                 'Comparative task volume, completed tasks, and points across your authorized team.'}
              </p>
            </div>

            <span className="text-xs text-blue-400 font-semibold px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-xl">
              {employeeWorkloadData.length} Associates in Scope
            </span>
          </div>

          {/* Large BI Bar Chart */}
          <div className="h-80 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={employeeWorkloadData.slice(0, 15)} margin={{ top: 20, right: 15, left: -10, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#25283a" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  stroke="#9ca3af" 
                  fontSize={11} 
                  tickLine={false} 
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                />
                <YAxis stroke="#6b7280" fontSize={11} tickLine={false} />
                <Tooltip content={<CustomBiTooltip />} />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '15px' }} />
                <Bar dataKey="total" name="Total Tasks" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Completed Tasks" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="running" name="In Progress" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="hold" name="On Hold" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Secondary Performance % Indicator Grid */}
          <div className="pt-4 border-t border-white/5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center justify-between">
              <span>Associate Performance Rate & Points</span>
              <span className="text-[11px] font-normal text-gray-500">Click any associate card to view detailed task breakdown</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {employeeWorkloadData.map(item => (
                <div 
                  key={item.staff.id}
                  onClick={() => setDrilldownStaff(item.staff)}
                  className="p-3.5 rounded-2xl bg-[#161826] border border-white/5 hover:border-blue-500/40 hover:bg-[#1a1c2e] cursor-pointer transition-all flex items-center justify-between group shadow-sm"
                >
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-white group-hover:text-blue-400 transition-colors flex items-center gap-1.5">
                      {item.name}
                      <Eye size={12} className="opacity-0 group-hover:opacity-100 text-blue-400 transition-opacity" />
                    </p>
                    <p className="text-[10px] text-gray-500 font-mono">
                      {item.employeeId} &bull; {item.role}
                    </p>
                    <div className="flex items-center gap-2 pt-1 text-[10px]">
                      <span className="text-emerald-400 font-bold">{item.completed} Done</span>
                      <span className="text-gray-600">&bull;</span>
                      <span className="text-amber-400 font-bold">{item.points} Pts</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[11px] font-black font-mono",
                      item.performancePct >= 80 ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" :
                      item.performancePct >= 50 ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" :
                      "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                    )}>
                      {item.performancePct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ROW 4: TECHNICIAN SELF-VIEW WORKLOAD (FOR TECHNICIAN ROLE)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {user.role === 'TECHNICIAN' && (
        <div className="bg-[#12131f] border border-white/10 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Target size={20} className="text-emerald-400" />
                Personal Execution & Efficiency Trends
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Historical log of your completed tasks, verified points, and active status.</p>
            </div>
            <button
              onClick={() => setDrilldownStaff(user)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-semibold transition-all"
            >
              <Eye size={14} />
              Inspect My Tasks
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="bg-[#161826] p-4 rounded-2xl border border-white/5">
              <span className="text-xs text-gray-400 font-semibold">Total Assigned</span>
              <p className="text-3xl font-black text-white mt-1">{summaryMetrics.total}</p>
              <p className="text-[10px] text-gray-500 mt-1">Across selected date range</p>
            </div>
            <div className="bg-[#161826] p-4 rounded-2xl border border-white/5">
              <span className="text-xs text-gray-400 font-semibold">Total Verified Points</span>
              <p className="text-3xl font-black text-purple-400 mt-1">{summaryMetrics.points}</p>
              <p className="text-[10px] text-purple-400/80 mt-1">Permanent database records</p>
            </div>
            <div className="bg-[#161826] p-4 rounded-2xl border border-white/5">
              <span className="text-xs text-gray-400 font-semibold">Completion Rate</span>
              <p className="text-3xl font-black text-emerald-400 mt-1">{summaryMetrics.performancePct}%</p>
              <p className="text-[10px] text-emerald-400/80 mt-1">Execution benchmark</p>
            </div>
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          TASK INSPECTION DRILLDOWN MODAL
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {drilldownStaff && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#12131f] border border-white/15 rounded-3xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-scaleIn">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <FileText className="text-blue-400" size={20} />
                  Historical Analytics Drill-Down &bull; {drilldownStaff.name}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Role: <span className="text-blue-400 font-semibold">{drilldownStaff.role}</span> &bull; 
                  ID: <span className="font-mono text-gray-300">{drilldownStaff.employeeId}</span> &bull; 
                  Period: <span className="text-white font-medium">{periodLabel}</span>
                </p>
              </div>
              <button
                onClick={() => setDrilldownStaff(null)}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-5">
              {(() => {
                const empId = drilldownStaff.employeeId ? drilldownStaff.employeeId.toString().trim() : '';
                const id = drilldownStaff.id;
                const name = drilldownStaff.name ? drilldownStaff.name.toLowerCase().trim() : '';

                const targetTasks = filteredTasks.filter(t => {
                  if (t.assignedTo === empId || t.assignedTo === id || (t.assignedTo && t.assignedTo.toLowerCase().trim() === name)) return true;
                  if (drilldownStaff.role === 'OFFICER') {
                    if (t.assignedBy === empId || t.assignedBy === id || t.createdBy === empId || t.responsibleOfficerId === empId) return true;
                  }
                  if (drilldownStaff.role === 'ENGINEER') {
                    if (t.concernEngineerId === empId || t.approvedBy === empId || t.recommendedBy === empId) return true;
                  }
                  if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
                    return t.assignedTechnicians.some(at => at.employeeId === empId || at.name?.toLowerCase().trim() === name);
                  }
                  return false;
                });

                const comp = targetTasks.filter(t => (t.status || '').toUpperCase() === 'COMPLETED').length;
                const run = targetTasks.filter(t => (t.status || '').toUpperCase() === 'RUNNING').length;
                const pend = targetTasks.filter(t => (t.status || '').toUpperCase() === 'PENDING').length;
                const hld = targetTasks.filter(t => (t.status || '').toUpperCase() === 'HOLD').length;
                const pts = targetTasks.filter(t => (t.status || '').toUpperCase() === 'COMPLETED').reduce((sum, t) => sum + (Number(t.points) || 1), 0);

                return (
                  <>
                    <div className="grid grid-cols-5 gap-3 text-center text-xs">
                      <div className="bg-white/5 p-3 rounded-2xl border border-white/10">
                        <p className="text-gray-400 text-[10px] uppercase font-bold">Total</p>
                        <p className="text-xl font-black text-white mt-0.5">{targetTasks.length}</p>
                      </div>
                      <div className="bg-emerald-500/10 p-3 rounded-2xl border border-emerald-500/20">
                        <p className="text-emerald-400 text-[10px] uppercase font-bold">Completed</p>
                        <p className="text-xl font-black text-emerald-400 mt-0.5">{comp}</p>
                      </div>
                      <div className="bg-amber-500/10 p-3 rounded-2xl border border-amber-500/20">
                        <p className="text-amber-400 text-[10px] uppercase font-bold">Running</p>
                        <p className="text-xl font-black text-amber-400 mt-0.5">{run}</p>
                      </div>
                      <div className="bg-rose-500/10 p-3 rounded-2xl border border-rose-500/20">
                        <p className="text-rose-400 text-[10px] uppercase font-bold">Hold</p>
                        <p className="text-xl font-black text-rose-400 mt-0.5">{hld}</p>
                      </div>
                      <div className="bg-purple-500/10 p-3 rounded-2xl border border-purple-500/20">
                        <p className="text-purple-400 text-[10px] uppercase font-bold">Points</p>
                        <p className="text-xl font-black text-purple-400 mt-0.5">{pts}</p>
                      </div>
                    </div>

                    <div className="border border-white/10 rounded-2xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#181a29] text-gray-400 uppercase tracking-wider text-[11px] border-b border-white/10">
                          <tr>
                            <th className="py-3 px-4 font-bold">Task Title</th>
                            <th className="py-3 px-3 font-bold">Model</th>
                            <th className="py-3 px-3 font-bold">Urgency</th>
                            <th className="py-3 px-3 font-bold">Status</th>
                            <th className="py-3 px-3 font-bold">Hold Reason</th>
                            <th className="py-3 px-3 font-bold text-right">Points</th>
                            <th className="py-3 px-4 text-center font-bold">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {targetTasks.map(t => (
                            <tr key={t.id} className="hover:bg-white/5 transition-colors">
                              <td className="py-3 px-4 font-semibold text-white max-w-[220px] truncate">{t.title}</td>
                              <td className="py-3 px-3 text-gray-300 font-mono text-[11px]">{t.model}</td>
                              <td className="py-3 px-3">
                                <span className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                  t.urgency === 'MOST_URGENT' ? "bg-rose-500/20 text-rose-400" :
                                  t.urgency === 'URGENT' ? "bg-amber-500/20 text-amber-400" :
                                  "bg-blue-500/20 text-blue-400"
                                )}>
                                  {t.urgency}
                                </span>
                              </td>
                              <td className="py-3 px-3">
                                <span className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                  (t.status || '').toUpperCase() === 'COMPLETED' ? "bg-emerald-500/20 text-emerald-400" :
                                  (t.status || '').toUpperCase() === 'RUNNING' ? "bg-amber-500/20 text-amber-400" :
                                  (t.status || '').toUpperCase() === 'HOLD' ? "bg-rose-500/20 text-rose-400" :
                                  "bg-sky-500/20 text-sky-400"
                                )}>
                                  {t.status}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-gray-400 italic max-w-[150px] truncate">
                                {(t.status || '').toUpperCase() === 'HOLD' ? (t.remarks || 'No remarks provided') : '-'}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-bold text-purple-400">
                                {t.points || 1}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {onSelectTask && (
                                  <button
                                    onClick={() => onSelectTask(t)}
                                    className="p-1 hover:bg-white/10 rounded text-blue-400 transition-colors"
                                    title="View Task Details"
                                  >
                                    <Eye size={14} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                          {targetTasks.length === 0 && (
                            <tr>
                              <td colSpan={7} className="py-8 text-center text-gray-500 italic">
                                No tasks found for this associate within the selected date horizon.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="p-4 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setDrilldownStaff(null)}
                className="px-5 py-2 bg-white/10 hover:bg-white/15 text-white font-semibold text-xs rounded-xl transition-all"
              >
                Close Drill-Down
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
