import React, { useState, useMemo } from 'react';
import { 
  User, 
  Attendance, 
  Role 
} from './types';
import { 
  Calendar, 
  Users, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertCircle, 
  Search, 
  Filter, 
  Download, 
  Building2, 
  Briefcase, 
  ShieldCheck, 
  ArrowRight,
  Sparkles,
  Layers,
  ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { cn } from './utils';

interface AssociateAttendanceProps {
  currentUser: User | null;
  staffList: User[];
  attendance: Attendance[];
  onUpdateAttendance: (employeeId: string, status: string) => Promise<void>;
}

export const AssociateAttendanceManagement: React.FC<AssociateAttendanceProps> = ({
  currentUser,
  staffList,
  attendance,
  onUpdateAttendance
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT' | 'LEAVE' | 'SHORT_LEAVE' | 'SHIFT_A' | 'SHIFT_B'>('ALL');
  const [adminTierFilter, setAdminTierFilter] = useState<string>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const todayStr = useMemo(() => {
    return new Date().toISOString().split('T')[0];
  }, []);

  const formattedDate = useMemo(() => {
    return new Date().toLocaleDateString('en-GB', { 
      weekday: 'long', 
      day: '2-digit', 
      month: 'long', 
      year: 'numeric' 
    });
  }, []);

  // Helper: Get user's today attendance status
  const getAttendanceStatus = (empId: string): string => {
    const rec = attendance.find(a => a.technicianId === empId && a.date === todayStr);
    return rec?.status || 'PRESENT'; // Default to PRESENT per system rule
  };

  // Determine hierarchy rules & associate concerns
  const hierarchyConfig = useMemo(() => {
    const role = currentUser?.role || '';
    const myEmpId = currentUser?.employeeId || '';
    const myDept = currentUser?.department || '';
    const myAssignedEngs = currentUser?.assignedEngineers || [];

    // 1. CBO to DCBO & HOD
    if (role === 'CBO') {
      const associates = staffList.filter(s => s.role === 'DCBO' || s.role === 'HOD' || s.role === 'DHOD');
      return {
        title: "Associate Concerns Attendance",
        subtitle: "Executive monitoring of DCBO & Department Heads (HOD) daily attendance",
        hierarchyBadge: "CBO ➔ DCBO & HOD",
        hierarchyDescription: "Technicians excluded. Managing direct executive associates (DCBO & HOD).",
        associates,
        isTechnicianView: false,
        allowedStatuses: [
          { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
          { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
          { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
          { label: 'Absent', value: 'ABSENT', color: 'bg-rose-600 hover:bg-rose-700' }
        ]
      };
    }

    // 2. DCBO to HOD
    if (role === 'DCBO') {
      const associates = staffList.filter(s => s.role === 'HOD' || s.role === 'DHOD');
      return {
        title: "Associate Concerns Attendance",
        subtitle: "Executive monitoring of Head of Departments (HOD) daily attendance",
        hierarchyBadge: "DCBO ➔ HOD",
        hierarchyDescription: "Technicians excluded. Overseeing Department Heads (HOD).",
        associates,
        isTechnicianView: false,
        allowedStatuses: [
          { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
          { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
          { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
          { label: 'Absent', value: 'ABSENT', color: 'bg-rose-600 hover:bg-rose-700' }
        ]
      };
    }

    // 3. HOD to INCHARGE
    if (role === 'HOD' || role === 'DHOD') {
      const associates = staffList.filter(s => {
        if (s.role !== 'IN_CHARGE') return false;
        if (myDept && s.department) {
          return s.department.toLowerCase() === myDept.toLowerCase();
        }
        return true;
      });
      return {
        title: "In-Charge Attendance Management",
        subtitle: "Daily attendance management for Section & Team In-Charges",
        hierarchyBadge: "HOD ➔ In-Charge",
        hierarchyDescription: "Monitoring assigned In-Charge personnel under department scope.",
        associates,
        isTechnicianView: false,
        allowedStatuses: [
          { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
          { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
          { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
          { label: 'Absent', value: 'ABSENT', color: 'bg-rose-600 hover:bg-rose-700' }
        ]
      };
    }

    // 4. INCHARGE to MODEL MANAGER & CONCERN ENGINEER
    if (role === 'IN_CHARGE') {
      const associates = staffList.filter(s => {
        if (s.role === 'MODEL_MANAGER') {
          if (Array.isArray(currentUser?.assignedEngineers) && currentUser.assignedEngineers.includes(s.employeeId)) return true;
          if (myDept && s.department && s.department.toLowerCase() === myDept.toLowerCase()) return true;
          return false;
        }
        if (s.role === 'ENGINEER') {
          // Strictly Concern Engineers assigned to this In-Charge
          return myAssignedEngs.includes(s.employeeId) || myAssignedEngs.includes(s.id) ||
                 s.supervisorId === currentUser?.id || s.supervisorId === currentUser?.employeeId ||
                 (Array.isArray(s.supervisor_ids) && (s.supervisor_ids.includes(currentUser?.id) || s.supervisor_ids.includes(currentUser?.employeeId)));
        }
        return false;
      });
      return {
        title: "Model Manager & Concern Engineer Attendance",
        subtitle: "Daily attendance oversight for Model Managers and assigned Concern Engineers",
        hierarchyBadge: "In-Charge ➔ Model Mgr & Concern Engineer",
        hierarchyDescription: "Monitoring Model Managers and designated Concern Engineers.",
        associates,
        isTechnicianView: false,
        allowedStatuses: [
          { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
          { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
          { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
          { label: 'Absent', value: 'ABSENT', color: 'bg-rose-600 hover:bg-rose-700' }
        ]
      };
    }

    // 5. MODEL MANAGER to Concern ENGINEER & OFFICER
    if (role === 'MODEL_MANAGER') {
      const associates = staffList.filter(s => {
        if (s.role === 'ENGINEER') {
          return myAssignedEngs.includes(s.employeeId) || myAssignedEngs.includes(s.id);
        }
        if (s.role === 'OFFICER') {
          const officerEngs = s.assignedEngineers || [];
          return officerEngs.some(engId => myAssignedEngs.includes(engId));
        }
        return false;
      });
      return {
        title: "Concern Engineer & Officer Attendance",
        subtitle: "Daily attendance management for Engineers and Officers under model scope",
        hierarchyBadge: "Model Mgr ➔ Concern Engineer & Officer",
        hierarchyDescription: "Supervising Engineers and Officers under model jurisdiction.",
        associates,
        isTechnicianView: false,
        allowedStatuses: [
          { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
          { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
          { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
          { label: 'Absent', value: 'ABSENT', color: 'bg-rose-600 hover:bg-rose-700' }
        ]
      };
    }

    // 6. ENGINEER to OFFICER (Strictly Concern Officers)
    if (role === 'ENGINEER') {
      const myId = currentUser?.id || '';
      const associates = staffList.filter(s => {
        if (s.role === 'OFFICER') {
          // Strictly Concern Officers who have this engineer in assignedEngineers
          const officerEngs = s.assignedEngineers || [];
          const isAssignedToOfficer = officerEngs.includes(myEmpId) || officerEngs.includes(myId);
          const isInMyEngineersList = Array.isArray(currentUser?.assignedEngineers) && (
            currentUser.assignedEngineers.includes(s.employeeId) || 
            currentUser.assignedEngineers.includes(s.id)
          );
          return isAssignedToOfficer || isInMyEngineersList;
        }
        return false;
      });
      return {
        title: "Concern Officer Attendance",
        subtitle: "Daily attendance monitoring for Officers assigned to your engineering portfolio",
        hierarchyBadge: "Engineer ➔ Concern Officers",
        hierarchyDescription: "Strictly monitoring attendance of officers associated with your engineering scope.",
        associates,
        isTechnicianView: false,
        allowedStatuses: [
          { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
          { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
          { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
          { label: 'Absent', value: 'ABSENT', color: 'bg-rose-600 hover:bg-rose-700' }
        ]
      };
    }

    // 7. OFFICER to TECHNICIAN (Strictly My Team Technicians)
    if (role === 'OFFICER') {
      const myId = currentUser?.id || '';
      const associates = staffList.filter(s => {
        if (s.role === 'TECHNICIAN') {
          // Strictly My Team: technician directly supervised by this officer
          const isPrimarySupervisor = s.supervisorId === myId || s.supervisorId === myEmpId;
          const isSecondarySupervisor = Array.isArray(s.supervisor_ids) && (
            s.supervisor_ids.includes(myEmpId) || 
            s.supervisor_ids.includes(myId)
          );
          return isPrimarySupervisor || isSecondarySupervisor;
        }
        return false;
      });
      return {
        title: "My Team Technician Attendance",
        subtitle: "Daily attendance and active shift allocation for your assigned team technicians",
        hierarchyBadge: "Officer ➔ My Team Technicians",
        hierarchyDescription: "Direct operational supervisor for technicians assigned strictly under your team.",
        associates,
        isTechnicianView: true,
        allowedStatuses: [
          { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
          { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
          { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
          { label: 'Absent', value: 'ABSENT', color: 'bg-rose-600 hover:bg-rose-700' },
          { label: 'Shift A (6AM-2PM)', value: 'SHIFT_A', color: 'bg-blue-600 hover:bg-blue-700' },
          { label: 'Shift B (2PM-10PM)', value: 'SHIFT_B', color: 'bg-indigo-600 hover:bg-indigo-700' }
        ]
      };
    }

    // 8. TECHNICIAN: Self Attendance
    if (role === 'TECHNICIAN') {
      const me = staffList.filter(s => s.employeeId === myEmpId || s.id === currentUser?.id);
      return {
        title: "My Attendance & Shift Status",
        subtitle: "Your personal daily attendance record and active shift schedule",
        hierarchyBadge: "Technician Portal",
        hierarchyDescription: "Viewing personal attendance logs and assigned shift.",
        associates: me,
        isTechnicianView: true,
        allowedStatuses: [
          { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
          { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
          { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
          { label: 'Shift A (6AM-2PM)', value: 'SHIFT_A', color: 'bg-blue-600 hover:bg-blue-700' },
          { label: 'Shift B (2PM-10PM)', value: 'SHIFT_B', color: 'bg-indigo-600 hover:bg-indigo-700' }
        ]
      };
    }

    // 9. SUPER_ADMIN: Full Directory with Tier Tabs
    const superAdminAssociates = staffList.filter(s => s.id !== currentUser?.id);
    return {
      title: "Organization Attendance Command",
      subtitle: "Complete institutional attendance control across all management and operational tiers",
      hierarchyBadge: "Super Admin Authority",
      hierarchyDescription: "Filter by tier: CBO, DCBO, HOD, In-Charge, Model Mgr, Engineer, Officer, Technician.",
      associates: superAdminAssociates,
      isTechnicianView: true,
      allowedStatuses: [
        { label: 'Present', value: 'PRESENT', color: 'bg-emerald-600 hover:bg-emerald-700' },
        { label: 'Leave', value: 'LEAVE', color: 'bg-amber-600 hover:bg-amber-700' },
        { label: 'Short-Leave', value: 'SHORT_LEAVE', color: 'bg-purple-600 hover:bg-purple-700' },
        { label: 'Absent', value: 'ABSENT', color: 'bg-rose-600 hover:bg-rose-700' },
        { label: 'Shift A', value: 'SHIFT_A', color: 'bg-blue-600 hover:bg-blue-700' },
        { label: 'Shift B', value: 'SHIFT_B', color: 'bg-indigo-600 hover:bg-indigo-700' }
      ]
    };
  }, [currentUser, staffList]);

  // Unique departments for filter dropdown
  const departmentsList = useMemo(() => {
    const set = new Set<string>();
    hierarchyConfig.associates.forEach(s => {
      if (s.department) set.add(s.department);
    });
    return Array.from(set).sort();
  }, [hierarchyConfig.associates]);

  // Filtered associates list
  const filteredAssociates = useMemo(() => {
    let list = hierarchyConfig.associates;

    // Super Admin Tier Filter
    if (currentUser?.role === 'SUPER_ADMIN') {
      if (adminTierFilter === 'CBO_DCBO') {
        list = list.filter(s => s.role === 'CBO' || s.role === 'DCBO');
      } else if (adminTierFilter === 'HOD') {
        list = list.filter(s => s.role === 'HOD' || s.role === 'DHOD');
      } else if (adminTierFilter === 'IN_CHARGE') {
        list = list.filter(s => s.role === 'IN_CHARGE');
      } else if (adminTierFilter === 'MODEL_MGR_ENG') {
        list = list.filter(s => s.role === 'MODEL_MANAGER' || s.role === 'ENGINEER');
      } else if (adminTierFilter === 'OFFICER') {
        list = list.filter(s => s.role === 'OFFICER');
      } else if (adminTierFilter === 'TECHNICIAN') {
        list = list.filter(s => s.role === 'TECHNICIAN');
      }
    }

    // Department Filter
    if (departmentFilter !== 'ALL') {
      list = list.filter(s => s.department === departmentFilter);
    }

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(s => 
        s.name.toLowerCase().includes(q) ||
        s.employeeId.toLowerCase().includes(q) ||
        (s.department && s.department.toLowerCase().includes(q)) ||
        (s.section && s.section.toLowerCase().includes(q)) ||
        (s.role && s.role.toLowerCase().includes(q))
      );
    }

    // Status Filter
    if (statusFilter !== 'ALL') {
      list = list.filter(s => {
        const st = getAttendanceStatus(s.employeeId);
        return st === statusFilter;
      });
    }

    return list;
  }, [hierarchyConfig.associates, currentUser?.role, adminTierFilter, departmentFilter, searchQuery, statusFilter, attendance]);

  // Attendance Metrics calculation
  const summaryKPIs = useMemo(() => {
    const list = hierarchyConfig.associates;
    const total = list.length;
    let present = 0;
    let absent = 0;
    let leave = 0;
    let shortLeave = 0;
    let shiftA = 0;
    let shiftB = 0;

    list.forEach(s => {
      const st = getAttendanceStatus(s.employeeId);
      if (st === 'PRESENT') present++;
      else if (st === 'ABSENT') absent++;
      else if (st === 'LEAVE') leave++;
      else if (st === 'SHORT_LEAVE') shortLeave++;
      else if (st === 'SHIFT_A') shiftA++;
      else if (st === 'SHIFT_B') shiftB++;
      else present++;
    });

    const activePresent = present + shiftA + shiftB;
    const presentRate = total > 0 ? Math.round((activePresent / total) * 100) : 0;

    return {
      total,
      present,
      absent,
      leave,
      shortLeave,
      shiftA,
      shiftB,
      activePresent,
      presentRate
    };
  }, [hierarchyConfig.associates, attendance]);

  // Handle single attendance update with feedback
  const handleUpdate = async (empId: string, status: string, name: string) => {
    setUpdatingId(empId);
    try {
      await onUpdateAttendance(empId, status);
      toast.success(`Attendance for ${name} updated to ${status.replace('_', ' ')}`);
    } catch (err) {
      console.error('Update attendance failed:', err);
      toast.error(`Failed to update attendance for ${name}`);
    } finally {
      setUpdatingId(null);
    }
  };

  // Export today's attendance sheet to Excel
  const handleExportAttendance = () => {
    try {
      const dataToExport = filteredAssociates.map(s => {
        const currentStatus = getAttendanceStatus(s.employeeId);
        return {
          'Employee ID': s.employeeId,
          'Name': s.name,
          'Role': s.role.replace('_', ' '),
          'Department': s.department || 'N/A',
          'Section': s.section || 'N/A',
          'Phone': s.phone || 'N/A',
          'Attendance Status': currentStatus,
          'Date': todayStr,
          'Supervised Under': hierarchyConfig.hierarchyBadge
        };
      });

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Today_Attendance");
      const filename = `Attendance_${currentUser?.role || 'Staff'}_${todayStr}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Attendance report exported as ${filename}`);
    } catch (err) {
      console.error('Attendance export error:', err);
      toast.error("Failed to export attendance report");
    }
  };

  // Format status badge styling
  const getBadgeClass = (status: string) => {
    switch (status) {
      case 'PRESENT':
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case 'ABSENT':
        return "bg-rose-500/20 text-rose-400 border-rose-500/30";
      case 'LEAVE':
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      case 'SHORT_LEAVE':
        return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      case 'SHIFT_A':
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case 'SHIFT_B':
        return "bg-indigo-500/20 text-indigo-400 border-indigo-500/30";
      default:
        return "bg-white/10 text-white border-white/20";
    }
  };

  // Format role badge styling
  const getRoleBadge = (role: Role) => {
    switch (role) {
      case 'CBO':
      case 'DCBO':
        return "bg-rose-500/20 text-rose-300 border-rose-500/30";
      case 'HOD':
      case 'DHOD':
        return "bg-blue-500/20 text-blue-300 border-blue-500/30";
      case 'IN_CHARGE':
        return "bg-amber-500/20 text-amber-300 border-amber-500/30";
      case 'MODEL_MANAGER':
        return "bg-purple-500/20 text-purple-300 border-purple-500/30";
      case 'ENGINEER':
        return "bg-teal-500/20 text-teal-300 border-teal-500/30";
      case 'OFFICER':
        return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
      case 'TECHNICIAN':
        return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
      default:
        return "bg-slate-500/20 text-slate-300 border-slate-500/30";
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ------------------------------------------------------------- */}
      {/* 1. Header & Hierarchy Chain Context                            */}
      {/* ------------------------------------------------------------- */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/90 border border-white/10 p-6 rounded-3xl backdrop-blur-xl shadow-2xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-xs font-bold text-blue-400 flex items-center gap-1.5 uppercase tracking-wider">
              <ShieldCheck size={14} />
              {hierarchyConfig.hierarchyBadge}
            </span>
            {currentUser?.role === 'CBO' || currentUser?.role === 'DCBO' ? (
              <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[11px] font-semibold text-emerald-400">
                Technicians Excluded &bull; Leadership Only
              </span>
            ) : null}
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            {hierarchyConfig.title}
          </h1>
          <p className="text-slate-400 text-sm mt-1 max-w-2xl">
            {hierarchyConfig.subtitle} &bull; {hierarchyConfig.hierarchyDescription}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="px-4 py-2.5 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-2.5 text-slate-300">
            <Calendar size={16} className="text-blue-400" />
            <span className="text-xs font-bold tracking-wide">{formattedDate}</span>
          </div>

          <button
            onClick={handleExportAttendance}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl flex items-center gap-2 text-xs font-bold transition-all shadow-lg shadow-blue-600/30"
          >
            <Download size={15} />
            <span>Export Sheet</span>
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 2. Institutional KPI Cards                                    */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
        {/* Total Monitored Associates */}
        <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Total In Scope</span>
            <Users size={16} className="text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white">{summaryKPIs.total}</div>
          <div className="text-[11px] text-slate-400 mt-1">Associate concerns monitored</div>
        </div>

        {/* Present Today */}
        <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Present Today</span>
            <CheckCircle2 size={16} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400">{summaryKPIs.activePresent}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            {summaryKPIs.presentRate}% Attendance rate
          </div>
        </div>

        {/* On Leave */}
        <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Full Leave</span>
            <Clock size={16} className="text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400">{summaryKPIs.leave}</div>
          <div className="text-[11px] text-slate-400 mt-1">Approved daily leaves</div>
        </div>

        {/* Short Leave */}
        <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Short Leave</span>
            <AlertCircle size={16} className="text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-400">{summaryKPIs.shortLeave}</div>
          <div className="text-[11px] text-slate-400 mt-1">Partial-day authorizations</div>
        </div>

        {/* Absent */}
        <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-lg col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Absent</span>
            <XCircle size={16} className="text-rose-400" />
          </div>
          <div className="text-2xl font-black text-rose-400">{summaryKPIs.absent}</div>
          <div className="text-[11px] text-slate-400 mt-1">Unmarked / absent staff</div>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 3. Super Admin Tier Switcher (Only visible to SUPER_ADMIN)    */}
      {/* ------------------------------------------------------------- */}
      {currentUser?.role === 'SUPER_ADMIN' && (
        <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
            <Layers size={14} className="text-purple-400" />
            <span>Admin Tier Selector (Hierarchy View)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'ALL', label: 'All Staff' },
              { id: 'CBO_DCBO', label: 'CBO & DCBO' },
              { id: 'HOD', label: 'HOD / DHOD' },
              { id: 'IN_CHARGE', label: 'In-Charge' },
              { id: 'MODEL_MGR_ENG', label: 'Model Mgr & Engineer' },
              { id: 'OFFICER', label: 'Officers' },
              { id: 'TECHNICIAN', label: 'Technicians' }
            ].map(tier => (
              <button
                key={tier.id}
                onClick={() => setAdminTierFilter(tier.id)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                  adminTierFilter === tier.id 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-600/30" 
                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                )}
              >
                {tier.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. Search & Filters Bar                                       */}
      {/* ------------------------------------------------------------- */}
      <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-lg flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, employee ID, designation or department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'ALL', label: 'All Status' },
            { id: 'PRESENT', label: 'Present' },
            { id: 'LEAVE', label: 'Leave' },
            { id: 'SHORT_LEAVE', label: 'Short' },
            { id: 'ABSENT', label: 'Absent' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-semibold transition-all",
                statusFilter === tab.id
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}

          {/* Department Filter dropdown if multiple departments */}
          {departmentsList.length > 1 && (
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900 text-white">All Departments</option>
              {departmentsList.map(dept => (
                <option key={dept} value={dept} className="bg-slate-900 text-white">
                  {dept}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 5. Associate Concerns Cards Grid                              */}
      {/* ------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAssociates.length === 0 ? (
          <div className="col-span-full py-16 text-center bg-slate-900/60 border border-dashed border-white/10 rounded-3xl">
            <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-300">No Associate Personnel Found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              No staff members match the active filters or hierarchy scope for this role.
            </p>
          </div>
        ) : (
          filteredAssociates.map(person => {
            const currentStatus = getAttendanceStatus(person.employeeId);
            const badgeClass = getBadgeClass(currentStatus);
            const roleBadgeClass = getRoleBadge(person.role);
            const isUpdating = updatingId === person.employeeId;

            return (
              <div
                key={person.id || person.employeeId}
                className="bg-slate-900/80 border border-white/10 hover:border-blue-500/40 rounded-2xl p-5 backdrop-blur-xl shadow-xl transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Top card header */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-extrabold text-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                        {person.name?.[0]?.toUpperCase() || 'U'}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-white text-base truncate group-hover:text-blue-300 transition-colors">
                          {person.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs font-mono text-slate-400">
                            {person.employeeId}
                          </span>
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold border uppercase", roleBadgeClass)}>
                            {person.role.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Active Status Badge */}
                    <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shrink-0", badgeClass)}>
                      {currentStatus.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Subordinate meta info */}
                  <div className="bg-white/5 border border-white/5 rounded-xl p-2.5 mb-4 text-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Building2 size={12} className="text-blue-400" />
                        Department:
                      </span>
                      <span className="text-slate-200 font-medium truncate max-w-[150px]">
                        {person.department || 'Executive Office'}
                      </span>
                    </div>
                    {person.section && (
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <Briefcase size={12} className="text-purple-400" />
                          Section:
                        </span>
                        <span className="text-slate-200 font-medium truncate max-w-[150px]">
                          {person.section}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Status action buttons */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Mark Today's Attendance
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {hierarchyConfig.allowedStatuses.map(opt => {
                      const isActive = currentStatus === opt.value;
                      return (
                        <button
                          key={opt.value}
                          disabled={isUpdating}
                          onClick={() => handleUpdate(person.employeeId, opt.value, person.name)}
                          className={cn(
                            "py-2 px-2 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-1 text-center",
                            isActive 
                              ? cn(opt.color, "text-white border-transparent shadow-lg shadow-blue-500/20")
                              : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          {isActive && <CheckCircle2 size={12} />}
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
