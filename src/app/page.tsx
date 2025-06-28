"use client";

import Image from "next/image";
import { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { DataGrid, GridColDef, GridRowsProp } from "@mui/x-data-grid";
import { validateData, ValidationError } from "./validation";
import Slider from '@mui/material/Slider';
import FileSaver from 'file-saver';
import * as aiService from './aiService';
import { FaMagic, FaSlidersH, FaUsers, FaUserTie, FaTasks, FaExclamationTriangle, FaFileExport } from 'react-icons/fa';
import { HiOutlineUpload } from 'react-icons/hi';
import { Plus, Trash2, Settings, BarChart3, Users, Search, Upload, Download, FileText, Database, Table } from 'lucide-react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

function parseFile(file: File, cb: (data: any[]) => void) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<any>) => cb(results.data as any[]),
    });
  } else if (ext === "xlsx") {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      cb(json as any[]);
    };
    reader.readAsArrayBuffer(file);
  }
}

function getColumns(data: any[]): GridColDef[] {
  if (!data || data.length === 0) return [];
  return Object.keys(data[0]).map((key) => ({
    field: key,
    headerName: key,
    width: 180,
    editable: true,
    flex: 1,
  }));
}

function getRows(data: any[]): GridRowsProp {
  return data.map((row, i) => ({ id: i, ...row }));
}

// Rule types
const RULE_TYPES = [
  { value: "coRun", label: "Co-run (select TaskIDs)" },
  { value: "slotRestriction", label: "Slot-restriction (ClientGroup/WorkerGroup + minCommonSlots)" },
  { value: "loadLimit", label: "Load-limit (WorkerGroup + maxSlotsPerPhase)" },
  { value: "phaseWindow", label: "Phase-window (TaskID + allowed phase list/range)" },
  { value: "patternMatch", label: "Pattern-match (regex + rule template + params)" },
  { value: "precedenceOverride", label: "Precedence override (global/specific rules with priority order)" },
  { value: "freeForm", label: "Free-form (Natural Language)" },
];

// Helper to add id property for DataGrid
function withRowId(data: any[] | null, entity: 'clients' | 'workers' | 'tasks') {
  if (!data) return [];
  const idField = entity === 'clients' ? 'ClientID' : entity === 'workers' ? 'WorkerID' : 'TaskID';
  return data.map(row => ({ ...row, id: row[idField] }));
}

// Update filtered state type
type FilteredState = {
  clients: any[] | null;
  workers: any[] | null;
  tasks: any[] | null;
};

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [clients, setClients] = useState<any[] | null>(null);
  const [workers, setWorkers] = useState<any[] | null>(null);
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [ruleType, setRuleType] = useState("coRun");
  const [ruleInput, setRuleInput] = useState("");
  const [freeFormInput, setFreeFormInput] = useState("");
  const [weights, setWeights] = useState({
    priorityLevel: 5,
    requestedTaskFulfillment: 5,
    fairness: 5,
    cost: 5,
    workload: 5,
  });
  const [search, setSearch] = useState({ clients: '', workers: '', tasks: '' });
  const [modify, setModify] = useState({ clients: '', workers: '', tasks: '' });
  const [filtered, setFiltered] = useState<FilteredState>({ clients: null, workers: null, tasks: null });
  const [parsedRule, setParsedRule] = useState<any>(null);
  const [ruleSuggestions, setRuleSuggestions] = useState<any[]>([]);

  // Run validations whenever data changes
  useEffect(() => {
    setValidationErrors(validateData(clients, workers, tasks));
  }, [clients, workers, tasks]);

  // Debug: Log clients and validation errors to the console
  useEffect(() => {
    console.log('Clients:', clients);
    console.log('Validation Errors:', validationErrors);
  }, [clients, validationErrors]);

  // AI header mapping on upload
  const handleFile = (entitySetter: (data: any[]) => void, entity: 'clients' | 'workers' | 'tasks') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      parseFile(file, async (raw: any[]) => {
        if (!raw.length) return entitySetter([]);
        const mappedHeaders = await aiService.mapHeaders(Object.keys(raw[0]), entity, apiKey);
        const mapped = raw.map(row => {
          const newRow: any = {};
          mappedHeaders.forEach((h, i) => newRow[h] = row[Object.keys(row)[i]]);
          return newRow;
        });
        entitySetter(mapped);
      });
    }
  };

  // AI search/filter
  useEffect(() => {
    async function doFilter() {
      const newFiltered = {
        clients: clients,
        workers: workers,
        tasks: tasks,
      };
      if (clients && search.clients) {
        newFiltered.clients = await aiService.queryData(search.clients, clients, apiKey);
      }
      if (workers && search.workers) {
        newFiltered.workers = await aiService.queryData(search.workers, workers, apiKey);
      }
      if (tasks && search.tasks) {
        newFiltered.tasks = await aiService.queryData(search.tasks, tasks, apiKey);
      }
      setFiltered(newFiltered);
    }
    doFilter();
  }, [search, clients, workers, tasks, apiKey]);

  // AI data modification
  const handleModify = async (entity: 'clients' | 'workers' | 'tasks') => {
    if (!modify[entity]) return;
    let newData = await aiService.modifyData(modify[entity], (entity === 'clients' ? clients : entity === 'workers' ? workers : tasks) || [], apiKey);
    if (entity === 'clients') setClients(newData);
    if (entity === 'workers') setWorkers(newData);
    if (entity === 'tasks') setTasks(newData);
    setModify(m => ({ ...m, [entity]: '' }));
  };

  // AI rule parsing for free-form
  const handleFreeFormRule = async () => {
    if (!freeFormInput) return;
    const parsed = await aiService.parseRule(freeFormInput, { clients, workers, tasks }, apiKey);
    setParsedRule(parsed);
  };

  // Memoize columns and rows for performance
  const clientsColumns = useMemo(() => getColumns(clients || []), [clients]);
  const workersColumns = useMemo(() => getColumns(workers || []), [workers]);
  const tasksColumns = useMemo(() => getColumns(tasks || []), [tasks]);

  const clientsRows = useMemo(() => getRows(clients || []), [clients]);
  const workersRows = useMemo(() => getRows(workers || []), [workers]);
  const tasksRows = useMemo(() => getRows(tasks || []), [tasks]);

  // Handle inline edit
  const handleEdit = (setter: (data: any[]) => void, data: any[] | null) => (params: any) => {
    if (!data) return;
    const updated = [...data];
    const idx = params.id;
    updated[idx] = { ...updated[idx], [params.field]: params.value };
    setter(updated);
  };

  // Helper to check if a cell has an error
  function cellHasError(entity: 'clients' | 'workers' | 'tasks', rowIndex: number, field: string) {
    return validationErrors.some(
      (err) => err.entity === entity && err.rowIndex === rowIndex && err.column === field
    );
  }

  // Helper to get error message for a cell
  function cellErrorMessage(entity: 'clients' | 'workers' | 'tasks', rowIndex: number, field: string) {
    const err = validationErrors.find(
      (err) => err.entity === entity && err.rowIndex === rowIndex && err.column === field
    );
    return err ? err.message : undefined;
  }

  // Add getCellClassName and renderCell to columns for error highlighting
  function enhanceColumns(columns: GridColDef[], entity: 'clients' | 'workers' | 'tasks', data: any[] | null) {
    return columns.map((col) => ({
      ...col,
      getCellClassName: (params: any) =>
        cellHasError(entity, params.id, col.field)
          ? "bg-red-100 text-red-700 font-semibold"
          : "",
      renderCell: (params: any) => {
        const error = cellErrorMessage(entity, params.id, col.field);
        return (
          <div>
            {params.value}
            {error && (
              <span className="block text-xs text-red-600 font-semibold">{error}</span>
            )}
          </div>
        );
      },
    }));
  }

  const clientsColumnsEnhanced = useMemo(() => enhanceColumns(clientsColumns, 'clients', clients), [clients, validationErrors]);
  const workersColumnsEnhanced = useMemo(() => enhanceColumns(workersColumns, 'workers', workers), [workers, validationErrors]);
  const tasksColumnsEnhanced = useMemo(() => enhanceColumns(tasksColumns, 'tasks', tasks), [tasks, validationErrors]);

  // Add rule handler
  function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    let newRule: any = { type: ruleType, created: new Date().toISOString() };
    if (ruleType === "freeForm") {
      newRule.description = freeFormInput;
    } else {
      newRule.input = ruleInput;
    }
    setRules((prev) => [...prev, newRule]);
    setRuleInput("");
    setFreeFormInput("");
  }

  // Remove rule handler
  function handleRemoveRule(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleWeightChange(key: string, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
  }

  // Export handlers
  function exportCSV(data: any[], filename: string) {
    if (!data) return;
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    FileSaver.saveAs(blob, filename);
  }

  function exportRulesAndWeights() {
    const blob = new Blob([
      JSON.stringify({ rules, weights }, null, 2)
    ], { type: 'application/json;charset=utf-8;' });
    FileSaver.saveAs(blob, 'rules.json');
  }

  const handleGetRuleSuggestions = async () => {
    const suggestions = await aiService.aiRuleRecommendations(clients, workers, tasks, apiKey);
    setRuleSuggestions(suggestions);
  };

  const handleAddSuggestedRule = (suggestion: any) => {
    setRules(prev => [...prev, suggestion]);
    setRuleSuggestions(s => s.filter(r => r !== suggestion));
  };

  const weightItems = [
    { key: 'priorityLevel', label: 'Priority Level Weight', color: 'purple' },
    { key: 'requestedTaskFulfillment', label: 'Requirement Task Fulfillment Weight', color: 'blue' },
    { key: 'fairness', label: 'Fairness Weight', color: 'green' },
    { key: 'cost', label: 'Cost Weight', color: 'orange' },
    { key: 'workload', label: 'Workload Weight', color: 'pink' }
  ] as const;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#181c2b] to-[#232946] flex flex-col items-center p-4 sm:p-8">
      <header className="w-full max-w-6xl flex flex-col items-center gap-2 mb-8">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-300 drop-shadow-lg">Data <span className="text-blue-400">Alchemist</span></h1>
        <p className="text-lg text-blue-200 text-center max-w-2xl">Forge Your Own AI Resource Allocation Configurator</p>
      </header>
      <section className="w-full max-w-6xl flex flex-col gap-8">
        {/* Rule Builder */}
        <div className="bg-slate-800/30 backdrop-blur-md rounded-3xl p-8 border border-slate-700/50 shadow-2xl mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Settings className="text-purple-400" size={24} />
            <h3 className="text-2xl font-bold text-white">Rule Builder</h3>
          </div>
          <div className="space-y-6">
            {/* Rule Type Selection */}
            <div>
              <label className="block text-gray-300 text-lg font-medium mb-3">Rule Type</label>
              <select
                value={ruleType}
                onChange={e => setRuleType(e.target.value)}
                className="w-full p-4 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
              >
                <option value="coRun">Co-run (select TaskIDs)</option>
                <option value="slotRestriction">Slot-restriction (ClientGroup/WorkerGroup + minCommonSlots)</option>
                <option value="loadLimit">Load-limit (WorkerGroup + maxSlotsPerPhase)</option>
                <option value="phaseWindow">Phase-window (TaskID + allowed phase list/range)</option>
                <option value="patternMatch">Pattern-match (regex + rule template + params)</option>
                <option value="precedenceOverride">Precedence override (global/specific rules with priority order)</option>
                <option value="freeForm">Free-form (Natural Language)</option>
              </select>
            </div>
            {/* Rule Input */}
            <div>
              <label className="block text-gray-300 text-lg font-medium mb-3">Rule Input</label>
              {ruleType === "freeForm" ? (
                <input
                  value={freeFormInput}
                  onChange={e => setFreeFormInput(e.target.value)}
                  placeholder="Describe your rule in plain English"
                  className="w-full p-4 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                />
              ) : (
                <textarea
                  value={ruleInput}
                  onChange={e => setRuleInput(e.target.value)}
                  placeholder="Enter rule details (e.g. TaskIDs, Group, etc.)"
                  className="w-full p-4 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200 min-h-[80px] resize-none"
                />
              )}
            </div>
            {/* Current Rules */}
            <div>
              <label className="block text-gray-300 text-lg font-medium mb-3">Current Rules</label>
              <div className="space-y-3">
                {rules.length === 0 ? (
                  <div className="text-gray-400">No rules added yet.</div>
                ) : (
                  rules.map((rule, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-4 bg-slate-700/30 rounded-xl border border-slate-600/30">
                      <span className="text-white font-medium flex-1">{rule.type === "freeForm" ? rule.description : `${rule.type}: ${rule.input}`}</span>
                      <button
                        onClick={() => handleRemoveRule(idx)}
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all duration-200"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex gap-4 pt-4">
              <button
                onClick={handleAddRule}
                className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-purple-500/25"
              >
                <Plus size={20} />
                Add Rule
              </button>
              <button
                onClick={handleGetRuleSuggestions}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-blue-500/25"
                disabled={!clients && !workers && !tasks}
              >
                Get AI Rule Recommendations
              </button>
            </div>
            {/* AI Rule Recommendations */}
            {ruleSuggestions.length > 0 && (
              <div className="mt-4 bg-blue-900/40 border border-blue-800 rounded p-2">
                <h4 className="font-semibold text-cyan-200 mb-1">Suggested Rules</h4>
                <ul className="space-y-1">
                  {ruleSuggestions.map((sug, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="font-mono text-blue-200">{sug.type}: {sug.reason}</span>
                      <button className="ml-auto text-green-400 hover:text-green-600 font-bold" onClick={() => handleAddSuggestedRule(sug)} type="button">Add</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Rule Preview for freeForm */}
            {ruleType === 'freeForm' && parsedRule && (
              <div className="bg-green-50 border border-green-200 rounded p-2 mt-2">
                <span className="text-green-700 font-mono">Parsed Rule Preview: {JSON.stringify(parsedRule)}</span>
              </div>
            )}
          </div>
        </div>
        {/* Prioritization & Weights */}
        <div className="bg-slate-800/30 backdrop-blur-md rounded-3xl p-8 border border-slate-700/50 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <BarChart3 className="text-purple-400" size={24} />
            <h3 className="text-2xl font-bold text-white">Prioritization & Weights</h3>
          </div>
          <div className="space-y-8">
            {weightItems.map((item) => (
              <div key={item.key} className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-gray-300 text-lg font-medium">{item.label}</label>
                  <span className="text-white font-bold text-xl">{weights[item.key]}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  value={weights[item.key]}
                  onChange={(_, v) => handleWeightChange(item.key, Array.isArray(v) ? v[0] : v)}
                  sx={{
                    color: item.color,
                    height: 8,
                    '& .MuiSlider-thumb': {
                      height: 24,
                      width: 24,
                      backgroundColor: '#fff',
                      border: '3px solid',
                      borderColor: item.color,
                      boxShadow: '0 2px 8px 0 rgba(0,0,0,0.10)',
                    },
                    '& .MuiSlider-rail': {
                      backgroundColor: '#334155',
                      opacity: 0.5,
                    },
                  }}
                  valueLabelDisplay="auto"
                />
              </div>
            ))}
          </div>
          <div className="mt-8 p-4 bg-slate-700/30 rounded-xl border border-slate-600/30">
            <p className="text-gray-300 text-sm">
              💡 <strong>Tip:</strong> Adjust these weights to fine-tune how your system prioritizes different factors. Higher values mean more importance in the allocation algorithm.
            </p>
          </div>
        </div>
        {/* Validation Issues */}
        {validationErrors.length > 0 && (
          <div className="bg-slate-800/30 backdrop-blur-md rounded-3xl p-8 border border-slate-700/50 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <AlertTriangle className="text-purple-400" size={24} />
              <h3 className="text-2xl font-bold text-white">Validation Issues</h3>
            </div>
            <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
              {validationErrors.map((issue, index) => {
                const type = issue.message.toLowerCase().includes('error') ? 'error' : 'warning';
                const getIcon = (type: string) => {
                  switch (type) {
                    case 'error': return <XCircle className="text-red-400" size={20} />;
                    case 'warning': return <AlertTriangle className="text-yellow-400" size={20} />;
                    default: return <CheckCircle className="text-green-400" size={20} />;
                  }
                };
                const getBackgroundColor = (type: string) => {
                  switch (type) {
                    case 'error': return 'bg-red-500/10 border-red-500/20';
                    case 'warning': return 'bg-yellow-500/10 border-yellow-500/20';
                    default: return 'bg-green-500/10 border-green-500/20';
                  }
                };
                return (
                  <div key={index} className={`p-4 rounded-xl border ${getBackgroundColor(type)}`}>
                    <div className="flex items-start gap-3">
                      {getIcon(type)}
                      <div className="flex-1">
                        <p className="text-white font-medium">{issue.message}</p>
                        <p className="text-gray-400 text-sm mt-1">{issue.column ? `Code: ${issue.column}` : ''}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 p-4 bg-slate-700/30 rounded-xl border border-slate-600/30">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300">
                  <strong>Summary:</strong> {validationErrors.filter(i => i.message.toLowerCase().includes('error')).length} errors, {validationErrors.filter(i => !i.message.toLowerCase().includes('error')).length} warnings
                </span>
              </div>
            </div>
          </div>
        )}
        {/* Clients Data Section (Plain MUI DataGrid) */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-xl p-4 border border-white/20 flex flex-col mt-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Users className="text-cyan-400" size={24} />
              <h3 className="text-2xl font-bold text-white">Clients Data</h3>
            </div>
            <div className="text-indigo-400 text-sm">{filtered.clients ? filtered.clients.length : 0} records</div>
          </div>
          {/* Search and Modify Bars */}
          <div className="flex flex-col gap-2 mb-6">
            <input
              className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
              placeholder="Search clients (natural language)"
              value={search.clients}
              onChange={e => setSearch(s => ({ ...s, clients: e.target.value }))}
            />
            <div className="flex gap-2">
              <input
                className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                placeholder="Modify clients (natural language)"
                value={modify.clients}
                onChange={e => setModify(m => ({ ...m, clients: e.target.value }))}
              />
              <button className="bg-indigo-600 text-white px-4 py-2 rounded-xl" onClick={() => handleModify('clients')}>Apply</button>
            </div>
          </div>
          {/* Controls */}
          <div className="flex gap-4 mb-6">
            <button className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-indigo-500/25">
              <Upload size={20} />
              <label className="cursor-pointer">
                <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFile(setClients, 'clients')} />
                Upload CSV
              </label>
            </button>
          </div>
          {/* Data Table (Plain MUI DataGrid) */}
          <div className="overflow-x-auto rounded-2xl border border-indigo-200">
            <DataGrid
              autoHeight
              rows={withRowId(filtered.clients, 'clients')}
              columns={clientsColumns}
              pageSizeOptions={[5, 10, 20]}
              initialState={{ pagination: { paginationModel: { pageSize: 5 } } }}
              processRowUpdate={(newRow, oldRow) => {
                const updated = [...(filtered.clients || [])];
                updated[newRow.id] = { ...updated[newRow.id], ...newRow };
                setClients(updated);
                return newRow;
              }}
            />
          </div>
          {/* Summary */}
          <div className="mt-6 flex justify-between items-center text-sm">
            <div className="text-gray-400">
              Showing {filtered.clients ? filtered.clients.length : 0} of {clients ? clients.length : 0} clients
            </div>
          </div>
        </div>
        {/* Workers Data */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-xl p-4 border border-white/20 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <FaUserTie className="text-cyan-400" size={24} />
              <h3 className="text-2xl font-bold text-white">Workers Data</h3>
            </div>
            <div className="text-indigo-400 text-sm">{filtered.workers ? filtered.workers.length : 0} records</div>
          </div>
          {/* Search and Modify Bars */}
          <div className="flex flex-col gap-2 mb-6">
            <input
              className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
              placeholder="Search workers (natural language)"
              value={search.workers}
              onChange={e => setSearch(s => ({ ...s, workers: e.target.value }))}
            />
            <div className="flex gap-2">
              <input
                className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                placeholder="Modify workers (natural language)"
                value={modify.workers}
                onChange={e => setModify(m => ({ ...m, workers: e.target.value }))}
              />
              <button className="bg-indigo-600 text-white px-4 py-2 rounded-xl" onClick={() => handleModify('workers')}>Apply</button>
            </div>
          </div>
          {/* Controls */}
          <div className="flex gap-4 mb-6">
            <button className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-indigo-500/25">
              <Upload size={20} />
              <label className="cursor-pointer">
                <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFile(setWorkers, 'workers')} />
                Upload CSV
              </label>
            </button>
          </div>
          {/* Data Table (Plain MUI DataGrid) */}
          <div className="overflow-x-auto rounded-2xl border border-indigo-200">
            <DataGrid
              autoHeight
              rows={withRowId(filtered.workers, 'workers')}
              columns={workersColumnsEnhanced}
              pageSizeOptions={[5, 10, 20]}
              initialState={{ pagination: { paginationModel: { pageSize: 5 } } }}
              processRowUpdate={(newRow, oldRow) => {
                const updated = [...(filtered.workers || [])];
                updated[newRow.id] = { ...updated[newRow.id], ...newRow };
                setWorkers(updated);
                return newRow;
              }}
            />
          </div>
          {/* Summary */}
          <div className="mt-6 flex justify-between items-center text-sm">
            <div className="text-gray-400">
              Showing {filtered.workers ? filtered.workers.length : 0} of {workers ? workers.length : 0} workers
            </div>
          </div>
        </div>
        {/* Tasks Data */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-xl p-4 border border-white/20 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <FaTasks className="text-cyan-400" size={24} />
              <h3 className="text-2xl font-bold text-white">Tasks Data</h3>
            </div>
            <div className="text-indigo-400 text-sm">{filtered.tasks ? filtered.tasks.length : 0} records</div>
          </div>
          {/* Search and Modify Bars */}
          <div className="flex flex-col gap-2 mb-6">
            <input
              className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
              placeholder="Search tasks (natural language)"
              value={search.tasks}
              onChange={e => setSearch(s => ({ ...s, tasks: e.target.value }))}
            />
            <div className="flex gap-2">
              <input
                className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200"
                placeholder="Modify tasks (natural language)"
                value={modify.tasks}
                onChange={e => setModify(m => ({ ...m, tasks: e.target.value }))}
              />
              <button className="bg-indigo-600 text-white px-4 py-2 rounded-xl" onClick={() => handleModify('tasks')}>Apply</button>
            </div>
          </div>
          {/* Controls */}
          <div className="flex gap-4 mb-6">
            <button className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-indigo-500/25">
              <Upload size={20} />
              <label className="cursor-pointer">
                <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFile(setTasks, 'tasks')} />
                Upload CSV
              </label>
            </button>
          </div>
          {/* Data Table (Plain MUI DataGrid) */}
          <div className="overflow-x-auto rounded-2xl border border-indigo-200">
            <DataGrid
              autoHeight
              rows={withRowId(filtered.tasks, 'tasks')}
              columns={tasksColumnsEnhanced}
              pageSizeOptions={[5, 10, 20]}
              initialState={{ pagination: { paginationModel: { pageSize: 5 } } }}
              processRowUpdate={(newRow, oldRow) => {
                const updated = [...(filtered.tasks || [])];
                updated[newRow.id] = { ...updated[newRow.id], ...newRow };
                setTasks(updated);
                return newRow;
              }}
            />
          </div>
          {/* Summary */}
          <div className="mt-6 flex justify-between items-center text-sm">
            <div className="text-gray-400">
              Showing {filtered.tasks ? filtered.tasks.length : 0} of {tasks ? tasks.length : 0} tasks
            </div>
          </div>
        </div>
        {/* Export Data */}
        <div className="bg-slate-800/30 backdrop-blur-md rounded-3xl p-8 border border-slate-700/50 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <Download className="text-purple-400" size={24} />
            <h3 className="text-2xl font-bold text-white">Export Data</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button
              onClick={() => exportCSV(clients || [], 'clients.csv')}
              disabled={!clients}
              className={`group p-6 bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/30 hover:border-blue-500/50 rounded-2xl transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/10 ${!clients ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/20 rounded-xl group-hover:bg-blue-500/30 transition-all duration-200">
                  <FileText className="text-blue-400 group-hover:text-blue-300" size={24} />
                </div>
                <div className="text-left">
                  <h4 className="text-white font-semibold text-lg">Export Clients CSV</h4>
                  <p className="text-gray-400 text-sm mt-1">Download your data as CSV/JSON</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => exportCSV(workers || [], 'workers.csv')}
              disabled={!workers}
              className={`group p-6 bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/30 hover:border-green-500/50 rounded-2xl transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-green-500/10 ${!workers ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-500/20 rounded-xl group-hover:bg-green-500/30 transition-all duration-200">
                  <Database className="text-green-400 group-hover:text-green-300" size={24} />
                </div>
                <div className="text-left">
                  <h4 className="text-white font-semibold text-lg">Export Workers CSV</h4>
                  <p className="text-gray-400 text-sm mt-1">Download your data as CSV/JSON</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => exportCSV(tasks || [], 'tasks.csv')}
              disabled={!tasks}
              className={`group p-6 bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/30 hover:border-purple-500/50 rounded-2xl transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-purple-500/10 ${!tasks ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-500/20 rounded-xl group-hover:bg-purple-500/30 transition-all duration-200">
                  <Table className="text-purple-400 group-hover:text-purple-300" size={24} />
                </div>
                <div className="text-left">
                  <h4 className="text-white font-semibold text-lg">Export Tasks CSV</h4>
                  <p className="text-gray-400 text-sm mt-1">Download your data as CSV/JSON</p>
                </div>
              </div>
            </button>

            <button
              onClick={exportRulesAndWeights}
              disabled={rules.length === 0}
              className={`group p-6 bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/30 hover:border-orange-500/50 rounded-2xl transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-orange-500/10 ${rules.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-orange-500/20 rounded-xl group-hover:bg-orange-500/30 transition-all duration-200">
                  <Download className="text-orange-400 group-hover:text-orange-300" size={24} />
                </div>
                <div className="text-left">
                  <h4 className="text-white font-semibold text-lg">Export Rules & Weights (rules.json)</h4>
                  <p className="text-gray-400 text-sm mt-1">Download your data as CSV/JSON</p>
                </div>
              </div>
            </button>
          </div>

          <div className="mt-8 p-6 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-2xl border border-purple-500/20">
            <h4 className="text-white font-semibold text-lg mb-3">📋 Export Instructions</h4>
            <ul className="text-gray-300 space-y-2 text-sm">
              <li>• <strong>CSV files</strong> can be opened in Excel or Google Sheets</li>
              <li>• <strong>JSON files</strong> contain your rules and configuration settings</li>
              <li>• All exports include timestamp and version information</li>
              <li>• Data is formatted for easy integration with other systems</li>
            </ul>
          </div>
        </div>
      </section>
      <footer className="mt-10 text-sm text-blue-400">&copy; 2024 Data Alchemist</footer>
    </div>
  );
}
