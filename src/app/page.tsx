"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { validateData, ValidationError } from "./validation";
import Slider from '@mui/material/Slider';
import FileSaver from 'file-saver';
import * as aiService from './aiService';
import { FaUserTie, FaTasks } from 'react-icons/fa';
import { Plus, Trash2, Settings, BarChart3, Users, Upload, Download, FileText, Database, Table } from 'lucide-react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

// Type for data rows
interface DataRow {
  [key: string]: string | number | boolean | object;
}

function parseFile(file: File, cb: (data: DataRow[]) => void) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<DataRow>) => cb(results.data as DataRow[]),
    });
  } else if (ext === "xlsx") {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      cb(json as DataRow[]);
    };
    reader.readAsArrayBuffer(file);
  }
}

// Helper to add id property for DataGrid
function withRowId(data: DataRow[] | null, entity: 'clients' | 'workers' | 'tasks') {
  if (!data) return [];
  const idField = entity === 'clients' ? 'ClientID' : entity === 'workers' ? 'WorkerID' : 'TaskID';
  return data.map(row => ({ ...row, id: row[idField] }));
}

type FilteredState = {
  clients: DataRow[] | null;
  workers: DataRow[] | null;
  tasks: DataRow[] | null;
};

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [clients, setClients] = useState<DataRow[] | null>(null);
  const [workers, setWorkers] = useState<DataRow[] | null>(null);
  const [tasks, setTasks] = useState<DataRow[] | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [rules, setRules] = useState<DataRow[]>([]);
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
  const [ruleSuggestions, setRuleSuggestions] = useState<DataRow[]>([]);
  const [lastModified, setLastModified] = useState<{ [key: string]: Date }>({});
  const [dataCorrections, setDataCorrections] = useState<{ [key: string]: Array<{
    rowIndex: number;
    column: string;
    currentValue: string | number | boolean | object;
    suggestedValue: string | number | boolean | object;
    reason: string;
    confidence: number;
  }> }>({});
  const [aiValidationErrors, setAiValidationErrors] = useState<{ [key: string]: Array<{
    field: string;
    message: string;
    severity: 'error' | 'warning';
  }> }>({});
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    setValidationErrors(validateData(clients, workers, tasks));
  }, [clients, workers, tasks]);

  // Clear AI errors when API key changes
  useEffect(() => {
    setAiError(null);
  }, [apiKey]);

  const handleFile = (entitySetter: (data: DataRow[]) => void, entity: 'clients' | 'workers' | 'tasks') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      parseFile(file, async (raw: DataRow[]) => {
        if (!raw.length) return entitySetter([]);
        const mappedHeaders = await aiService.mapHeaders(Object.keys(raw[0]), entity, apiKey);
        const mapped = raw.map(row => {
          const newRow: DataRow = {};
          mappedHeaders.forEach((h, i) => newRow[h] = row[Object.keys(row)[i]] ?? '');
          return newRow;
        });
        entitySetter(mapped);
      });
    }
  };

  useEffect(() => {
    async function doFilter() {
      const newFiltered: FilteredState = {
        clients: clients,
        workers: workers,
        tasks: tasks,
      };
      
      // Only use AI search if API key is provided
      if (apiKey) {
        if (clients && search.clients) {
          try {
            newFiltered.clients = await aiService.queryData(search.clients, clients, apiKey);
          } catch (error) {
            console.error('Search failed:', error);
            // Fallback to basic search if AI fails
            const query = search.clients.toLowerCase();
            newFiltered.clients = clients.filter(client =>
              Object.values(client).some(value => 
                String(value).toLowerCase().includes(query)
              )
            );
          }
        }
        if (workers && search.workers) {
          try {
            newFiltered.workers = await aiService.queryData(search.workers, workers, apiKey);
          } catch (error) {
            console.error('Search failed:', error);
            // Fallback to basic search if AI fails
            const query = search.workers.toLowerCase();
            newFiltered.workers = workers.filter(worker =>
              Object.values(worker).some(value => 
                String(value).toLowerCase().includes(query)
              )
            );
          }
        }
        if (tasks && search.tasks) {
          try {
            newFiltered.tasks = await aiService.queryData(search.tasks, tasks, apiKey);
          } catch (error) {
            console.error('Search failed:', error);
            // Fallback to basic search if AI fails
            const query = search.tasks.toLowerCase();
            newFiltered.tasks = tasks.filter(task =>
              Object.values(task).some(value => 
                String(value).toLowerCase().includes(query)
              )
            );
          }
        }
      } else {
        // Basic search without AI
        if (clients && search.clients) {
          const query = search.clients.toLowerCase();
          newFiltered.clients = clients.filter(client =>
            Object.values(client).some(value => 
              String(value).toLowerCase().includes(query)
            )
          );
        }
        if (workers && search.workers) {
          const query = search.workers.toLowerCase();
          newFiltered.workers = workers.filter(worker =>
            Object.values(worker).some(value => 
              String(value).toLowerCase().includes(query)
            )
          );
        }
        if (tasks && search.tasks) {
          const query = search.tasks.toLowerCase();
          newFiltered.tasks = tasks.filter(task =>
            Object.values(task).some(value => 
              String(value).toLowerCase().includes(query)
            )
          );
        }
      }
      
      setFiltered(newFiltered);
    }
    doFilter();
  }, [search, clients, workers, tasks, apiKey]);

  const handleModify = async (entity: 'clients' | 'workers' | 'tasks') => {
    if (!modify[entity]) return;
    
    if (!apiKey) {
      setAiError('Please enter your OpenAI API key to use AI modification features');
      return;
    }
    
    setIsLoadingAI(true);
    setAiError(null);
    
    try {
      const data = entity === 'clients' ? clients : entity === 'workers' ? workers : tasks;
      if (!data) {
        setAiError(`No ${entity} data available to modify`);
        return;
      }
      
      const newData = await aiService.modifyData(modify[entity], data, apiKey);
      
      if (entity === 'clients') setClients(newData);
      if (entity === 'workers') setWorkers(newData);
      if (entity === 'tasks') setTasks(newData);
      
      setModify(m => ({ ...m, [entity]: '' }));
      setLastModified({ [entity]: new Date() });
      
      // Show success message
      setAiError(`✅ Successfully modified ${entity} data`);
      setTimeout(() => setAiError(null), 3000);
    } catch (error) {
      console.error('Modification failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to modify data';
      setAiError(errorMessage);
    } finally {
      setIsLoadingAI(false);
    }
  };

  function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    const newRule: DataRow = { type: ruleType, created: new Date().toISOString() };
    if (ruleType === "freeForm") {
      newRule.description = freeFormInput;
    } else {
      newRule.input = ruleInput;
    }
    setRules((prev) => [...prev, newRule]);
    setRuleInput("");
    setFreeFormInput("");
    setLastModified({ rules: new Date() });
  }

  function handleRemoveRule(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx));
    setLastModified({ rules: new Date() });
  }

  function handleWeightChange(key: string, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
    setLastModified({ weights: new Date() });
  }

  function exportCSV(data: DataRow[], filename: string) {
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
    if (!apiKey) {
      setAiError('Please enter your OpenAI API key to use AI features');
      return;
    }
    
    setIsLoadingAI(true);
    setAiError(null);
    try {
      const suggestions = await aiService.aiRuleRecommendations(clients, workers, tasks, apiKey);
      // Convert RuleSuggestion to DataRow for compatibility
      const dataRowSuggestions: DataRow[] = suggestions.map(s => ({
        type: s.type,
        description: s.reason,
        tasks: s.tasks || [],
        worker: s.worker || ''
      }));
      setRuleSuggestions(dataRowSuggestions);
      setLastModified({ ruleSuggestions: new Date() });
    } catch (error) {
      console.error('Failed to get rule suggestions:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to get AI rule suggestions';
      setAiError(errorMessage);
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleAddSuggestedRule = (suggestion: DataRow) => {
    setRules(prev => [...prev, suggestion]);
    setRuleSuggestions(s => s.filter(r => r !== suggestion));
    setLastModified({ rules: new Date() });
  };

  // AI Data Correction Functions
  const handleGetDataCorrections = async (entity: 'clients' | 'workers' | 'tasks') => {
    if (!apiKey) {
      setAiError('Please enter your OpenAI API key to use AI features');
      return;
    }
    
    setIsLoadingAI(true);
    setAiError(null);
    try {
      const data = entity === 'clients' ? clients : entity === 'workers' ? workers : tasks;
      if (!data) return;
      
      const corrections = await aiService.suggestDataCorrections(data, entity, apiKey);
      setDataCorrections(prev => ({ ...prev, [entity]: corrections }));
      setLastModified({ [`corrections_${entity}`]: new Date() });
    } catch (error) {
      console.error('Failed to get data corrections:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to get AI data corrections';
      setAiError(errorMessage);
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleApplyCorrection = (
    entity: 'clients' | 'workers' | 'tasks',
    correction: {
      rowIndex: number;
      column: string;
      currentValue: string | number | boolean | object;
      suggestedValue: string | number | boolean | object;
      reason: string;
      confidence: number;
    }
  ) => {
    const data = entity === 'clients' ? clients : entity === 'workers' ? workers : tasks;
    if (!data) return;
    
    const newData = [...data];
    if (newData[correction.rowIndex]) {
      newData[correction.rowIndex] = { ...newData[correction.rowIndex], [correction.column]: correction.suggestedValue };
      
      if (entity === 'clients') setClients(newData);
      if (entity === 'workers') setWorkers(newData);
      if (entity === 'tasks') setTasks(newData);
      
      // Remove the applied correction
      setDataCorrections(prev => ({
        ...prev,
        [entity]: prev[entity]?.filter(c => c !== correction) || []
      }));
      
      setLastModified({ [entity]: new Date() });
    }
  };

  // AI Validation Functions
  const handleRunAIValidation = async (entity: 'clients' | 'workers' | 'tasks') => {
    if (!apiKey) {
      setAiError('Please enter your OpenAI API key to use AI features');
      return;
    }
    
    setIsLoadingAI(true);
    setAiError(null);
    try {
      const data = entity === 'clients' ? clients : entity === 'workers' ? workers : tasks;
      if (!data) return;
      
      const aiErrors = await aiService.validateDataWithAI(data, entity, apiKey);
      setAiValidationErrors(prev => ({ ...prev, [entity]: aiErrors }));
      setLastModified({ [`aiValidation_${entity}`]: new Date() });
    } catch (error) {
      console.error('Failed to run AI validation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to run AI validation';
      setAiError(errorMessage);
    } finally {
      setIsLoadingAI(false);
    }
  };

  // Natural Language Rule Parsing
  const handleParseNaturalLanguageRule = async () => {
    if (!apiKey) {
      setAiError('Please enter your OpenAI API key to use AI features');
      return;
    }
    
    if (!freeFormInput.trim()) {
      setAiError('Please enter a natural language rule');
      return;
    }
    
    setIsLoadingAI(true);
    setAiError(null);
    try {
      const parsedRule = await aiService.parseRule(freeFormInput, { clients, workers, tasks }, apiKey);
      
      // Add the parsed rule to the rules list
      const newRule: DataRow = {
        type: parsedRule.type,
        description: parsedRule.description || freeFormInput,
        tasks: parsedRule.tasks || [],
        parameters: parsedRule.parameters || {},
        created: new Date().toISOString(),
        aiParsed: true
      };
      
      setRules(prev => [...prev, newRule]);
      setFreeFormInput("");
      setLastModified({ rules: new Date() });
      
      // Show success message
      setAiError(`✅ Rule parsed successfully! Type: ${parsedRule.type}`);
      setTimeout(() => setAiError(null), 3000);
    } catch (error) {
      console.error('Failed to parse rule:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to parse natural language rule';
      setAiError(errorMessage);
    } finally {
      setIsLoadingAI(false);
    }
  };

  // Simple allocation preview function
  const generateAllocationPreview = () => {
    if (!clients || !workers || !tasks) return [];

    const allocations: Array<{
      client: string;
      task: string;
      worker: string;
      score: number;
      reason: string;
    }> = [];

    // For each client, try to assign their requested tasks
    clients.forEach(client => {
      const requestedTasks = (client.RequestedTaskIDs as string || '').split(',').map((id: string) => id.trim()).filter(Boolean);
      const priorityLevel = Number(client.PriorityLevel) || 1;
      
      requestedTasks.forEach(taskId => {
        const task = tasks.find(t => t.TaskID === taskId);
        if (!task) return;

        // Find workers who can do this task
        const requiredSkills = (task.RequiredSkills as string || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        const qualifiedWorkers = workers.filter(worker => {
          const workerSkills = (worker.Skills as string || '').split(',').map((s: string) => s.trim()).filter(Boolean);
          return requiredSkills.every(skill => workerSkills.includes(skill));
        });

        if (qualifiedWorkers.length === 0) return;

        // Calculate allocation score for each qualified worker
        qualifiedWorkers.forEach(worker => {
          let score = 0;
          const reasons: string[] = [];

          // Priority Level Weight (1-5 scale, higher is better)
          const priorityScore = priorityLevel * (weights.priorityLevel / 100);
          score += priorityScore;
          reasons.push(`Priority ${priorityLevel} (${priorityScore.toFixed(2)} pts)`);

          // Fairness Weight (prefer workers with less current load)
          const currentLoad = allocations.filter(a => a.worker === worker.WorkerID).length;
          const fairnessScore = (1 / (currentLoad + 1)) * (weights.fairness / 100);
          score += fairnessScore;
          reasons.push(`Fairness ${fairnessScore.toFixed(2)} pts`);

          // Workload Weight (prefer workers with more available slots)
          try {
            const availableSlots = JSON.parse(worker.AvailableSlots as string);
            const workloadScore = (availableSlots.length / 10) * (weights.workload / 100);
            score += workloadScore;
            reasons.push(`Workload ${workloadScore.toFixed(2)} pts`);
          } catch {
            reasons.push(`Workload 0 pts (invalid slots)`);
          }

          // Cost Weight (prefer workers with lower qualification levels = lower cost)
          const qualificationLevel = Number(worker.QualificationLevel) || 1;
          const costScore = (1 / qualificationLevel) * (weights.cost / 100);
          score += costScore;
          reasons.push(`Cost ${costScore.toFixed(2)} pts`);

          allocations.push({
            client: client.ClientName as string,
            task: task.TaskName as string,
            worker: worker.WorkerName as string,
            score: score,
            reason: reasons.join(', ')
          });
        });
      });
    });

    // Sort by score (highest first) and take top allocations
    return allocations
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Show top 20 allocations
  };

  const allocationPreview = generateAllocationPreview();

  // Function to get validation errors for a specific cell
  const getCellValidationErrors = (entity: 'clients' | 'workers' | 'tasks', rowId: string | number, column: string) => {
    return validationErrors.filter(error => {
      if (error.entity !== entity || error.column !== column) return false;
      
      // Handle global errors (rowIndex is null)
      if (error.rowIndex === null) return true;
      
      // For row-specific errors, we need to find the actual row by ID
      const data = entity === 'clients' ? clients : entity === 'workers' ? workers : tasks;
      if (!data) return false;
      
      // Find the row by its ID field
      const idField = entity === 'clients' ? 'ClientID' : entity === 'workers' ? 'WorkerID' : 'TaskID';
      const actualRow = data.find(row => row[idField] === rowId);
      
      // If we found the row, check if the error rowIndex matches
      if (actualRow) {
        const rowIndex = data.indexOf(actualRow);
        return rowIndex === error.rowIndex;
      }
      
      return false;
    });
  };

  // Function to get cell styling based on validation errors
  const getCellStyle = (entity: 'clients' | 'workers' | 'tasks', rowId: string | number, column: string) => {
    const errors = getCellValidationErrors(entity, rowId, column);
    if (errors.length === 0) return {};
    
    const hasError = errors.some(e => e.severity === 'error');
    const hasWarning = errors.some(e => e.severity === 'warning');
    
    if (hasError) {
      return {
        backgroundColor: 'rgba(239, 68, 68, 0.2)', // red background
        border: '2px solid rgba(239, 68, 68, 0.6)',
        borderRadius: '4px'
      };
    } else if (hasWarning) {
      return {
        backgroundColor: 'rgba(245, 158, 11, 0.2)', // yellow background
        border: '2px solid rgba(245, 158, 11, 0.6)',
        borderRadius: '4px'
      };
    }
    return {};
  };

  // Enhanced column definitions with cell highlighting
  const getEnhancedColumns = (data: DataRow[], entity: 'clients' | 'workers' | 'tasks'): GridColDef[] => {
    if (!data || data.length === 0) return [];
    return Object.keys(data[0]).map((key) => ({
      field: key,
      headerName: key,
      width: 180,
      editable: true,
      flex: 1,
      renderCell: (params) => {
        const cellErrors = getCellValidationErrors(entity, params.row.id, key);
        const cellStyle = getCellStyle(entity, params.row.id, key);
        
        // Debug logging
        if (cellErrors.length > 0) {
          console.log(`Cell ${entity} ${params.row.id} ${key} has ${cellErrors.length} errors:`, cellErrors);
        }
        
        return (
          <div 
            style={cellStyle}
            className="w-full h-full flex items-center px-2"
            title={cellErrors.length > 0 ? cellErrors.map(e => e.message).join('\n') : ''}
          >
            <span className="truncate">{String(params.value || '')}</span>
            {cellErrors.length > 0 && (
              <div className="ml-1">
                {cellErrors.some(e => e.severity === 'error') ? (
                  <div className="w-2 h-2 bg-red-500 rounded-full" title="Error" />
                ) : (
                  <div className="w-2 h-2 bg-yellow-500 rounded-full" title="Warning" />
                )}
              </div>
            )}
          </div>
        );
      }
    }));
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
      
      {/* OpenAI API Key Input */}
      <div className="w-full max-w-6xl bg-slate-800/30 backdrop-blur-md rounded-3xl p-6 border border-slate-700/50 shadow-2xl mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-gradient-to-r from-green-400 to-blue-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">AI</span>
          </div>
          <h3 className="text-xl font-bold text-white">AI Features Configuration</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">OpenAI API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-... (Enter your OpenAI API key to enable AI features)"
              className="w-full p-3 bg-slate-700/50 border border-slate-600/50 rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
            />
            <p className="text-gray-400 text-xs mt-1">
              💡 Your API key is stored locally and never sent to our servers. AI features include header mapping, natural language search, rule parsing, and data corrections.
            </p>
          </div>
          
          {/* AI Status */}
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${apiKey ? 'bg-green-500/20 border border-green-500/30' : 'bg-gray-500/20 border border-gray-500/30'}`}>
              <div className={`w-2 h-2 rounded-full ${apiKey ? 'bg-green-400' : 'bg-gray-400'}`}></div>
              <span className={`text-sm font-medium ${apiKey ? 'text-green-300' : 'text-gray-400'}`}>
                {apiKey ? 'AI Features Enabled' : 'AI Features Disabled'}
              </span>
            </div>
            {isLoadingAI && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/20 border border-blue-500/30 rounded-lg">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm font-medium text-blue-300">Processing...</span>
              </div>
            )}
          </div>
          
          {/* AI Error Display */}
          {aiError && (
            <div className={`p-4 rounded-xl border ${aiError.startsWith('✅') ? 'bg-green-900/20 border-green-800/30' : 'bg-red-900/20 border-red-800/30'}`}>
              <div className="flex items-start gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center ${aiError.startsWith('✅') ? 'bg-green-500' : 'bg-red-500'}`}>
                  {aiError.startsWith('✅') ? (
                    <span className="text-white text-xs">✓</span>
                  ) : (
                    <span className="text-white text-xs">!</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${aiError.startsWith('✅') ? 'text-green-300' : 'text-red-300'}`}>
                    {aiError.startsWith('✅') ? 'Success' : 'AI Error'}
                  </div>
                  <div className="text-gray-300 text-sm mt-1">
                    {aiError.startsWith('✅') ? aiError.substring(1) : aiError}
                  </div>
                </div>
                <button
                  onClick={() => setAiError(null)}
                  className="text-gray-400 hover:text-gray-300 transition-colors"
                >
                  <span className="text-lg">×</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
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
                      <span className="text-white font-medium flex-1">{rule.type === "freeForm" ? String(rule.description || '') : `${rule.type}: ${String(rule.input || '')}`}</span>
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
              {ruleType === "freeForm" && (
                <button
                  onClick={handleParseNaturalLanguageRule}
                  disabled={!apiKey || !freeFormInput.trim() || isLoadingAI}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" style={{ display: isLoadingAI ? 'block' : 'none' }}></div>
                  <span>🤖 Parse with AI</span>
                </button>
              )}
              <button
                onClick={handleGetRuleSuggestions}
                disabled={!apiKey || (!clients && !workers && !tasks) || isLoadingAI}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
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
                      <span className="font-mono text-blue-200">{String(sug.type || '')}: {String(sug.description || '')}</span>
                      <button className="ml-auto text-green-400 hover:text-green-600 font-bold" onClick={() => handleAddSuggestedRule(sug)} type="button">Add</button>
                    </li>
                  ))}
                </ul>
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

        {/* Allocation Preview */}
        {allocationPreview.length > 0 && (
          <div className="bg-slate-800/30 backdrop-blur-md rounded-3xl p-8 border border-slate-700/50 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <Users className="text-green-400" size={24} />
              <h3 className="text-2xl font-bold text-white">Allocation Preview</h3>
              <div className="ml-auto text-sm text-gray-400">
                Based on current weights • Top {allocationPreview.length} assignments
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-600/50">
                    <th className="text-left p-3 text-gray-300 font-medium">Client</th>
                    <th className="text-left p-3 text-gray-300 font-medium">Task</th>
                    <th className="text-left p-3 text-gray-300 font-medium">Worker</th>
                    <th className="text-left p-3 text-gray-300 font-medium">Score</th>
                    <th className="text-left p-3 text-gray-300 font-medium">Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationPreview.map((allocation, index) => (
                    <tr key={index} className="border-b border-slate-600/30 hover:bg-slate-700/20 transition-colors">
                      <td className="p-3 text-white font-medium">{allocation.client}</td>
                      <td className="p-3 text-blue-300">{allocation.task}</td>
                      <td className="p-3 text-green-300">{allocation.worker}</td>
                      <td className="p-3">
                        <span className="bg-purple-500/20 text-purple-300 px-2 py-1 rounded-lg font-mono text-sm">
                          {allocation.score.toFixed(2)}
                        </span>
                      </td>
                      <td className="p-3 text-gray-400 text-xs max-w-md truncate" title={allocation.reason}>
                        {allocation.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-6 p-4 bg-green-900/20 border border-green-800/30 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="text-green-400" size={16} />
                <span className="text-green-300 font-medium">Allocation Algorithm Active</span>
              </div>
              <p className="text-gray-300 text-sm">
                This preview shows how your current weight settings would influence task assignments. 
                Higher scores indicate better matches based on your prioritization preferences.
              </p>
            </div>
          </div>
        )}

        {/* No Allocation Preview */}
        {(!clients || !workers || !tasks) && (
          <div className="bg-slate-800/30 backdrop-blur-md rounded-3xl p-8 border border-slate-700/50 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <Users className="text-gray-400" size={24} />
              <h3 className="text-2xl font-bold text-white">Allocation Preview</h3>
            </div>
            
            <div className="text-center py-12">
              <div className="text-gray-400 mb-4">
                <Users className="mx-auto mb-4" size={48} />
                <h4 className="text-lg font-medium mb-2">No Data Available</h4>
                <p className="text-sm">
                  Upload clients, workers, and tasks data to see allocation previews based on your weight settings.
                </p>
              </div>
              <div className="flex justify-center gap-4">
                <div className="text-xs text-gray-500">
                  <div className="font-medium mb-1">Required:</div>
                  <div>• Clients with RequestedTaskIDs</div>
                  <div>• Workers with Skills</div>
                  <div>• Tasks with RequiredSkills</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Validation Issues */}
        {validationErrors.length > 0 && (
          <div className="bg-slate-800/30 backdrop-blur-md rounded-3xl p-8 border border-slate-700/50 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <AlertTriangle className="text-purple-400" size={24} />
              <h3 className="text-2xl font-bold text-white">Validation Issues</h3>
            </div>
            <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
              {validationErrors.map((issue, index) => {
                const getIcon = (severity: string) => {
                  switch (severity) {
                    case 'error': return <XCircle className="text-red-400" size={20} />;
                    case 'warning': return <AlertTriangle className="text-yellow-400" size={20} />;
                    default: return <CheckCircle className="text-green-400" size={20} />;
                  }
                };
                const getBackgroundColor = (severity: string) => {
                  switch (severity) {
                    case 'error': return 'bg-red-500/10 border-red-500/20';
                    case 'warning': return 'bg-yellow-500/10 border-yellow-500/20';
                    default: return 'bg-green-500/10 border-green-500/20';
                  }
                };
                return (
                  <div key={index} className={`flex items-start gap-3 p-4 rounded-xl border ${getBackgroundColor(issue.severity)}`}>
                    {getIcon(issue.severity)}
                    <div className="flex-1">
                      <div className="text-white font-medium">{issue.message}</div>
                      <div className="text-gray-400 text-sm mt-1">
                        {issue.entity} {issue.rowIndex !== null ? `(Row ${issue.rowIndex + 1})` : ''} {issue.column ? `- ${issue.column}` : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Data Tables */}
        <div className="flex flex-col gap-8">
          {/* Clients Data */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-xl p-4 border border-white/20 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <Users className="text-purple-400" size={24} />
                <h3 className="text-2xl font-bold text-white">Clients Data</h3>
              </div>
              <div className="text-indigo-400 text-sm">{filtered.clients ? filtered.clients.length : 0} records</div>
            </div>
            {/* Search and Modify Bars */}
            <div className="flex flex-col gap-2 mb-6">
              <input
                className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                placeholder="Search clients (natural language)"
                value={search.clients}
                onChange={e => setSearch(s => ({ ...s, clients: e.target.value }))}
              />
              <div className="flex gap-2">
                <input
                  className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                  placeholder="Modify clients (natural language)"
                  value={modify.clients}
                  onChange={e => setModify(m => ({ ...m, clients: e.target.value }))}
                />
                <button className="bg-purple-600 text-white px-4 py-2 rounded-xl" onClick={() => handleModify('clients')}>Apply</button>
              </div>
            </div>
            {/* Controls */}
            <div className="flex gap-4 mb-6">
              <button className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-purple-500/25">
                <Upload size={20} />
                <label className="cursor-pointer">
                  <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFile(setClients, 'clients')} />
                  Upload CSV
                </label>
              </button>
              {clients && clients.length > 0 && (
                <>
                  <button 
                    onClick={() => handleGetDataCorrections('clients')}
                    disabled={!apiKey || isLoadingAI}
                    className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" style={{ display: isLoadingAI ? 'block' : 'none' }}></div>
                    <span>🤖 AI Corrections</span>
                  </button>
                  <button 
                    onClick={() => handleRunAIValidation('clients')}
                    disabled={!apiKey || isLoadingAI}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" style={{ display: isLoadingAI ? 'block' : 'none' }}></div>
                    <span>🔍 AI Validation</span>
                  </button>
                  <button 
                    onClick={() => exportCSV(clients, 'clients.csv')}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-indigo-500/25"
                  >
                    <Download size={20} />
                    Export CSV
                  </button>
                </>
              )}
            </div>
            
            {/* AI Data Corrections */}
            {dataCorrections.clients && dataCorrections.clients.length > 0 && (
              <div className="mb-6 p-4 bg-green-900/20 border border-green-800/30 rounded-xl">
                <h4 className="text-green-300 font-medium mb-3 flex items-center gap-2">
                  <span>🤖</span> AI Suggested Corrections ({dataCorrections.clients.length})
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {dataCorrections.clients.map((correction, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-green-800/20 rounded-lg">
                      <div className="flex-1">
                        <div className="text-white text-sm">
                          Row {correction.rowIndex + 1}, {correction.column}: {String(correction.currentValue)} → {String(correction.suggestedValue)}
                        </div>
                        <div className="text-green-300 text-xs mt-1">{correction.reason}</div>
                      </div>
                      <button
                        onClick={() => handleApplyCorrection('clients', correction)}
                        className="ml-3 px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded-lg transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* AI Validation Errors */}
            {aiValidationErrors.clients && aiValidationErrors.clients.length > 0 && (
              <div className="mb-6 p-4 bg-blue-900/20 border border-blue-800/30 rounded-xl">
                <h4 className="text-blue-300 font-medium mb-3 flex items-center gap-2">
                  <span>🔍</span> AI Validation Issues ({aiValidationErrors.clients.length})
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {aiValidationErrors.clients.map((error, idx) => (
                    <div key={idx} className={`p-3 rounded-lg ${error.severity === 'error' ? 'bg-red-800/20 border border-red-800/30' : 'bg-yellow-800/20 border border-yellow-800/30'}`}>
                      <div className={`text-sm ${error.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}`}>
                        {error.field}: {error.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Data Table (Plain MUI DataGrid) */}
            <div className="mb-2 text-sm text-blue-300">
              💡 Click on any cell to edit. Changes are automatically saved.
            </div>
            {/* Validation Legend */}
            {validationErrors.length > 0 && (
              <div className="mb-3 flex items-center gap-4 text-xs">
                <span className="text-gray-400">Validation: {validationErrors.length} issues found</span>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500/20 border border-red-500/60 rounded"></div>
                  <span className="text-red-400">Error</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-yellow-500/20 border border-yellow-500/60 rounded"></div>
                  <span className="text-yellow-400">Warning</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span className="text-gray-400">Error indicator</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-gray-400">Warning indicator</span>
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded-2xl border border-indigo-200">
              <DataGrid
                autoHeight
                rows={withRowId(filtered.clients, 'clients')}
                columns={getEnhancedColumns(filtered.clients || [], 'clients')}
                pageSizeOptions={[5, 10, 20]}
                initialState={{ pagination: { paginationModel: { pageSize: 5 } } }}
                processRowUpdate={(newRow) => {
                  // Find the original row index in the main clients array
                  const originalIndex = clients?.findIndex(client => client.ClientID === newRow.ClientID);
                  if (originalIndex !== undefined && originalIndex !== -1 && clients) {
                    // Update the original clients array
                    const updatedClients = [...clients];
                    updatedClients[originalIndex] = { ...updatedClients[originalIndex], ...newRow };
                    setClients(updatedClients);
                    setLastModified(prev => ({ ...prev, clients: new Date() }));
                  }
                  return newRow;
                }}
              />
            </div>
            {/* Summary */}
            <div className="mt-6 flex justify-between items-center text-sm">
              <div className="text-gray-400">
                Showing {filtered.clients ? filtered.clients.length : 0} of {clients ? clients.length : 0} clients
              </div>
              {lastModified.clients && (
                <div className="text-green-400 text-xs">
                  Last modified: {lastModified.clients.toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
          {/* Workers Data */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-xl p-4 border border-white/20 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <FaUserTie className="text-purple-400" size={24} />
                <h3 className="text-2xl font-bold text-white">Workers Data</h3>
              </div>
              <div className="text-indigo-400 text-sm">{filtered.workers ? filtered.workers.length : 0} records</div>
            </div>
            {/* Search and Modify Bars */}
            <div className="flex flex-col gap-2 mb-6">
              <input
                className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                placeholder="Search workers (natural language)"
                value={search.workers}
                onChange={e => setSearch(s => ({ ...s, workers: e.target.value }))}
              />
              <div className="flex gap-2">
                <input
                  className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                  placeholder="Modify workers (natural language)"
                  value={modify.workers}
                  onChange={e => setModify(m => ({ ...m, workers: e.target.value }))}
                />
                <button className="bg-purple-600 text-white px-4 py-2 rounded-xl" onClick={() => handleModify('workers')}>Apply</button>
              </div>
            </div>
            {/* Controls */}
            <div className="flex gap-4 mb-6">
              <button className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-purple-500/25">
                <Upload size={20} />
                <label className="cursor-pointer">
                  <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFile(setWorkers, 'workers')} />
                  Upload CSV
                </label>
              </button>
              {workers && workers.length > 0 && (
                <>
                  <button 
                    onClick={() => handleGetDataCorrections('workers')}
                    disabled={!apiKey || isLoadingAI}
                    className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" style={{ display: isLoadingAI ? 'block' : 'none' }}></div>
                    <span>🤖 AI Corrections</span>
                  </button>
                  <button 
                    onClick={() => handleRunAIValidation('workers')}
                    disabled={!apiKey || isLoadingAI}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" style={{ display: isLoadingAI ? 'block' : 'none' }}></div>
                    <span>🔍 AI Validation</span>
                  </button>
                  <button 
                    onClick={() => exportCSV(workers, 'workers.csv')}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-indigo-500/25"
                  >
                    <Download size={20} />
                    Export CSV
                  </button>
                </>
              )}
            </div>
            
            {/* AI Data Corrections */}
            {dataCorrections.workers && dataCorrections.workers.length > 0 && (
              <div className="mb-6 p-4 bg-green-900/20 border border-green-800/30 rounded-xl">
                <h4 className="text-green-300 font-medium mb-3 flex items-center gap-2">
                  <span>🤖</span> AI Suggested Corrections ({dataCorrections.workers.length})
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {dataCorrections.workers.map((correction, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-green-800/20 rounded-lg">
                      <div className="flex-1">
                        <div className="text-white text-sm">
                          Row {correction.rowIndex + 1}, {correction.column}: {String(correction.currentValue)} → {String(correction.suggestedValue)}
                        </div>
                        <div className="text-green-300 text-xs mt-1">{correction.reason}</div>
                      </div>
                      <button
                        onClick={() => handleApplyCorrection('workers', correction)}
                        className="ml-3 px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded-lg transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* AI Validation Errors */}
            {aiValidationErrors.workers && aiValidationErrors.workers.length > 0 && (
              <div className="mb-6 p-4 bg-blue-900/20 border border-blue-800/30 rounded-xl">
                <h4 className="text-blue-300 font-medium mb-3 flex items-center gap-2">
                  <span>🔍</span> AI Validation Issues ({aiValidationErrors.workers.length})
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {aiValidationErrors.workers.map((error, idx) => (
                    <div key={idx} className={`p-3 rounded-lg ${error.severity === 'error' ? 'bg-red-800/20 border border-red-800/30' : 'bg-yellow-800/20 border border-yellow-800/30'}`}>
                      <div className={`text-sm ${error.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}`}>
                        {error.field}: {error.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Data Table (Plain MUI DataGrid) */}
            <div className="mb-2 text-sm text-blue-300">
              💡 Click on any cell to edit. Changes are automatically saved.
            </div>
            {/* Validation Legend */}
            {validationErrors.length > 0 && (
              <div className="mb-3 flex items-center gap-4 text-xs">
                <span className="text-gray-400">Validation: {validationErrors.length} issues found</span>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500/20 border border-red-500/60 rounded"></div>
                  <span className="text-red-400">Error</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-yellow-500/20 border border-yellow-500/60 rounded"></div>
                  <span className="text-yellow-400">Warning</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span className="text-gray-400">Error indicator</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-gray-400">Warning indicator</span>
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded-2xl border border-indigo-200">
              <DataGrid
                autoHeight
                rows={withRowId(filtered.workers, 'workers')}
                columns={getEnhancedColumns(filtered.workers || [], 'workers')}
                pageSizeOptions={[5, 10, 20]}
                initialState={{ pagination: { paginationModel: { pageSize: 5 } } }}
                processRowUpdate={(newRow) => {
                  // Find the original row index in the main workers array
                  const originalIndex = workers?.findIndex(worker => worker.WorkerID === newRow.WorkerID);
                  if (originalIndex !== undefined && originalIndex !== -1 && workers) {
                    // Update the original workers array
                    const updatedWorkers = [...workers];
                    updatedWorkers[originalIndex] = { ...updatedWorkers[originalIndex], ...newRow };
                    setWorkers(updatedWorkers);
                    setLastModified(prev => ({ ...prev, workers: new Date() }));
                  }
                  return newRow;
                }}
              />
            </div>
            {/* Summary */}
            <div className="mt-6 flex justify-between items-center text-sm">
              <div className="text-gray-400">
                Showing {filtered.workers ? filtered.workers.length : 0} of {workers ? workers.length : 0} workers
              </div>
              {lastModified.workers && (
                <div className="text-green-400 text-xs">
                  Last modified: {lastModified.workers.toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
          {/* Tasks Data */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-xl p-4 border border-white/20 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <FaTasks className="text-purple-400" size={24} />
                <h3 className="text-2xl font-bold text-white">Tasks Data</h3>
              </div>
              <div className="text-indigo-400 text-sm">{filtered.tasks ? filtered.tasks.length : 0} records</div>
            </div>
            {/* Search and Modify Bars */}
            <div className="flex flex-col gap-2 mb-6">
              <input
                className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                placeholder="Search tasks (natural language)"
                value={search.tasks}
                onChange={e => setSearch(s => ({ ...s, tasks: e.target.value }))}
              />
              <div className="flex gap-2">
                <input
                  className="w-full pl-4 pr-4 py-3 border rounded-xl text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                  placeholder="Modify tasks (natural language)"
                  value={modify.tasks}
                  onChange={e => setModify(m => ({ ...m, tasks: e.target.value }))}
                />
                <button className="bg-purple-600 text-white px-4 py-2 rounded-xl" onClick={() => handleModify('tasks')}>Apply</button>
              </div>
            </div>
            {/* Controls */}
            <div className="flex gap-4 mb-6">
              <button className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-purple-500/25">
                <Upload size={20} />
                <label className="cursor-pointer">
                  <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFile(setTasks, 'tasks')} />
                  Upload CSV
                </label>
              </button>
              {tasks && tasks.length > 0 && (
                <>
                  <button 
                    onClick={() => handleGetDataCorrections('tasks')}
                    disabled={!apiKey || isLoadingAI}
                    className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" style={{ display: isLoadingAI ? 'block' : 'none' }}></div>
                    <span>🤖 AI Corrections</span>
                  </button>
                  <button 
                    onClick={() => handleRunAIValidation('tasks')}
                    disabled={!apiKey || isLoadingAI}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" style={{ display: isLoadingAI ? 'block' : 'none' }}></div>
                    <span>🔍 AI Validation</span>
                  </button>
                  <button 
                    onClick={() => exportCSV(tasks, 'tasks.csv')}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-indigo-500/25"
                  >
                    <Download size={20} />
                    Export CSV
                  </button>
                </>
              )}
            </div>
            
            {/* AI Data Corrections */}
            {dataCorrections.tasks && dataCorrections.tasks.length > 0 && (
              <div className="mb-6 p-4 bg-green-900/20 border border-green-800/30 rounded-xl">
                <h4 className="text-green-300 font-medium mb-3 flex items-center gap-2">
                  <span>🤖</span> AI Suggested Corrections ({dataCorrections.tasks.length})
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {dataCorrections.tasks.map((correction, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-green-800/20 rounded-lg">
                      <div className="flex-1">
                        <div className="text-white text-sm">
                          Row {correction.rowIndex + 1}, {correction.column}: {String(correction.currentValue)} → {String(correction.suggestedValue)}
                        </div>
                        <div className="text-green-300 text-xs mt-1">{correction.reason}</div>
                      </div>
                      <button
                        onClick={() => handleApplyCorrection('tasks', correction)}
                        className="ml-3 px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded-lg transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* AI Validation Errors */}
            {aiValidationErrors.tasks && aiValidationErrors.tasks.length > 0 && (
              <div className="mb-6 p-4 bg-blue-900/20 border border-blue-800/30 rounded-xl">
                <h4 className="text-blue-300 font-medium mb-3 flex items-center gap-2">
                  <span>🔍</span> AI Validation Issues ({aiValidationErrors.tasks.length})
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {aiValidationErrors.tasks.map((error, idx) => (
                    <div key={idx} className={`p-3 rounded-lg ${error.severity === 'error' ? 'bg-red-800/20 border border-red-800/30' : 'bg-yellow-800/20 border border-yellow-800/30'}`}>
                      <div className={`text-sm ${error.severity === 'error' ? 'text-red-300' : 'text-yellow-300'}`}>
                        {error.field}: {error.message}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Data Table (Plain MUI DataGrid) */}
            <div className="mb-2 text-sm text-blue-300">
              💡 Click on any cell to edit. Changes are automatically saved.
            </div>
            {/* Validation Legend */}
            {validationErrors.length > 0 && (
              <div className="mb-3 flex items-center gap-4 text-xs">
                <span className="text-gray-400">Validation: {validationErrors.length} issues found</span>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500/20 border border-red-500/60 rounded"></div>
                  <span className="text-red-400">Error</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-yellow-500/20 border border-yellow-500/60 rounded"></div>
                  <span className="text-yellow-400">Warning</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span className="text-gray-400">Error indicator</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-gray-400">Warning indicator</span>
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded-2xl border border-indigo-200">
              <DataGrid
                autoHeight
                rows={withRowId(filtered.tasks, 'tasks')}
                columns={getEnhancedColumns(filtered.tasks || [], 'tasks')}
                pageSizeOptions={[5, 10, 20]}
                initialState={{ pagination: { paginationModel: { pageSize: 5 } } }}
                processRowUpdate={(newRow) => {
                  // Find the original row index in the main tasks array
                  const originalIndex = tasks?.findIndex(task => task.TaskID === newRow.TaskID);
                  if (originalIndex !== undefined && originalIndex !== -1 && tasks) {
                    // Update the original tasks array
                    const updatedTasks = [...tasks];
                    updatedTasks[originalIndex] = { ...updatedTasks[originalIndex], ...newRow };
                    setTasks(updatedTasks);
                    setLastModified(prev => ({ ...prev, tasks: new Date() }));
                  }
                  return newRow;
                }}
              />
            </div>
            {/* Summary */}
            <div className="mt-6 flex justify-between items-center text-sm">
              <div className="text-gray-400">
                Showing {filtered.tasks ? filtered.tasks.length : 0} of {tasks ? tasks.length : 0} tasks
              </div>
              {lastModified.tasks && (
                <div className="text-green-400 text-xs">
                  Last modified: {lastModified.tasks.toLocaleTimeString()}
                </div>
              )}
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
                  <Settings className="text-orange-400 group-hover:text-orange-300" size={24} />
                </div>
                <div className="text-left">
                  <h4 className="text-white font-semibold text-lg">Export Rules & Weights</h4>
                  <p className="text-gray-400 text-sm mt-1">Download your configuration as JSON</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </section>
      <footer className="mt-10 text-sm text-blue-400">&copy; 2024 Data Alchemist</footer>
    </div>
  );
}