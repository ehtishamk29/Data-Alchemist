// Validation utility for Data Alchemist

export type ValidationError = {
  entity: 'clients' | 'workers' | 'tasks';
  rowIndex: number | null; // null for global errors
  column?: string;
  message: string;
  severity: 'error' | 'warning';
};

// Type for data rows
interface DataRow {
  [key: string]: string | number | boolean | object;
}

// Helper function to parse phase ranges and lists
function parsePhases(phaseStr: string): number[] {
  try {
    // Try to parse as JSON array first
    const parsed = JSON.parse(phaseStr);
    if (Array.isArray(parsed)) {
      return parsed.filter(p => typeof p === 'number' && p > 0);
    }
  } catch {
    // Try to parse as range (e.g., "1-3") or comma-separated list
    if (phaseStr.includes('-')) {
      const [start, end] = phaseStr.split('-').map(s => parseInt(s.trim()));
      if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }
    } else {
      const phases = phaseStr.split(',').map(s => parseInt(s.trim()));
      if (phases.every(p => !isNaN(p) && p > 0)) {
        return phases;
      }
    }
  }
  return [];
}

// Helper function to validate JSON format
function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

// Helper function to validate task ID format
function isValidTaskID(taskID: string): boolean {
  // Task IDs should follow pattern T followed by numbers (e.g., T1, T17, T99)
  // But we'll flag obviously invalid ones like TX
  return /^T\d+$/.test(taskID);
}

export function validateData(
  clients: DataRow[] | null,
  workers: DataRow[] | null,
  tasks: DataRow[] | null
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Missing required columns validation
  if (clients && clients.length > 0) {
    const requiredClientCols = ['ClientID', 'ClientName', 'PriorityLevel', 'RequestedTaskIDs', 'GroupTag', 'AttributesJSON'];
    requiredClientCols.forEach((col) => {
      if (!Object.keys(clients[0] || {}).includes(col)) {
        errors.push({ 
          entity: 'clients', 
          rowIndex: null, 
          column: col, 
          message: `Missing required column: ${col}`,
          severity: 'error'
        });
      }
    });
  }

  if (workers && workers.length > 0) {
    const requiredWorkerCols = ['WorkerID', 'WorkerName', 'Skills', 'AvailableSlots', 'MaxLoadPerPhase', 'WorkerGroup', 'QualificationLevel'];
    requiredWorkerCols.forEach((col) => {
      if (!Object.keys(workers[0] || {}).includes(col)) {
        errors.push({ 
          entity: 'workers', 
          rowIndex: null, 
          column: col, 
          message: `Missing required column: ${col}`,
          severity: 'error'
        });
      }
    });
  }

  if (tasks && tasks.length > 0) {
    const requiredTaskCols = ['TaskID', 'TaskName', 'Category', 'Duration', 'RequiredSkills', 'PreferredPhases', 'MaxConcurrent'];
    requiredTaskCols.forEach((col) => {
      if (!Object.keys(tasks[0] || {}).includes(col)) {
        errors.push({ 
          entity: 'tasks', 
          rowIndex: null, 
          column: col, 
          message: `Missing required column: ${col}`,
          severity: 'error'
        });
      }
    });
  }

  // 2. Duplicate IDs validation
  if (clients && clients.length > 0) {
    const seen = new Set();
    clients.forEach((row, i) => {
      if (seen.has(row.ClientID)) {
        errors.push({ 
          entity: 'clients', 
          rowIndex: i, 
          column: 'ClientID', 
          message: `Duplicate ClientID: ${row.ClientID}`,
          severity: 'error'
        });
      }
      seen.add(row.ClientID);
    });
  }

  if (workers && workers.length > 0) {
    const seen = new Set();
    workers.forEach((row, i) => {
      if (seen.has(row.WorkerID)) {
        errors.push({ 
          entity: 'workers', 
          rowIndex: i, 
          column: 'WorkerID', 
          message: `Duplicate WorkerID: ${row.WorkerID}`,
          severity: 'error'
        });
      }
      seen.add(row.WorkerID);
    });
  }

  if (tasks && tasks.length > 0) {
    const seen = new Set();
    tasks.forEach((row, i) => {
      if (seen.has(row.TaskID)) {
        errors.push({ 
          entity: 'tasks', 
          rowIndex: i, 
          column: 'TaskID', 
          message: `Duplicate TaskID: ${row.TaskID}`,
          severity: 'error'
        });
      }
      seen.add(row.TaskID);
    });
  }

  // 3. Malformed lists validation (non-numeric in AvailableSlots)
  if (workers && workers.length > 0) {
    workers.forEach((row, i) => {
      try {
        const slots = JSON.parse(row.AvailableSlots as string);
        if (!Array.isArray(slots)) {
          errors.push({ 
            entity: 'workers', 
            rowIndex: i, 
            column: 'AvailableSlots', 
            message: 'AvailableSlots must be a JSON array',
            severity: 'error'
          });
        } else if (slots.some((s: unknown) => typeof s !== 'number' || s <= 0)) {
          errors.push({ 
            entity: 'workers', 
            rowIndex: i, 
            column: 'AvailableSlots', 
            message: 'AvailableSlots must contain only positive numbers',
            severity: 'error'
          });
        }
      } catch {
        errors.push({ 
          entity: 'workers', 
          rowIndex: i, 
          column: 'AvailableSlots', 
          message: 'Malformed AvailableSlots (should be JSON array)',
          severity: 'error'
        });
      }
    });
  }

  // 4. Out-of-range values validation
  if (clients && clients.length > 0) {
    clients.forEach((row, i) => {
      const val = Number(row.PriorityLevel);
      if (isNaN(val) || val < 1 || val > 5) {
        errors.push({ 
          entity: 'clients', 
          rowIndex: i, 
          column: 'PriorityLevel', 
          message: 'PriorityLevel must be between 1 and 5',
          severity: 'error'
        });
      }
    });
  }

  if (tasks && tasks.length > 0) {
    tasks.forEach((row, i) => {
      const val = Number(row.Duration);
      if (isNaN(val) || val < 1) {
        errors.push({ 
          entity: 'tasks', 
          rowIndex: i, 
          column: 'Duration', 
          message: 'Duration must be >= 1',
          severity: 'error'
        });
      }
    });
  }

  if (workers && workers.length > 0) {
    workers.forEach((row, i) => {
      const val = Number(row.MaxLoadPerPhase);
      if (isNaN(val) || val < 1) {
        errors.push({ 
          entity: 'workers', 
          rowIndex: i, 
          column: 'MaxLoadPerPhase', 
          message: 'MaxLoadPerPhase must be >= 1',
          severity: 'error'
        });
      }
    });
  }

  // 5. Broken JSON validation (AttributesJSON)
  if (clients && clients.length > 0) {
    clients.forEach((row, i) => {
      if (row.AttributesJSON && typeof row.AttributesJSON === 'string') {
        if (!isValidJSON(row.AttributesJSON)) {
          errors.push({ 
            entity: 'clients', 
            rowIndex: i, 
            column: 'AttributesJSON', 
            message: 'Malformed JSON in AttributesJSON (should be valid JSON format)',
            severity: 'error'
          });
        }
      }
    });
  }

  // 6. Unknown references validation (RequestedTaskIDs not in tasks)
  if (clients && clients.length > 0 && tasks && tasks.length > 0) {
    const taskIDs = new Set(tasks.map((t) => t.TaskID));
    clients.forEach((row, i) => {
      const requestedTasks = (row.RequestedTaskIDs as string || '').split(',').map((id: string) => id.trim()).filter(Boolean);
      requestedTasks.forEach((taskId: string) => {
        if (!taskIDs.has(taskId)) {
          errors.push({ 
            entity: 'clients', 
            rowIndex: i, 
            column: 'RequestedTaskIDs', 
            message: `Unknown TaskID referenced: ${taskId}`,
            severity: 'error'
          });
        }
      });
    });
  }

  // 6.5. Invalid TaskID format validation (based on sample data patterns)
  if (clients && clients.length > 0) {
    clients.forEach((row, i) => {
      const requestedTasks = (row.RequestedTaskIDs as string || '').split(',').map((id: string) => id.trim()).filter(Boolean);
      requestedTasks.forEach((taskId: string) => {
        if (!isValidTaskID(taskId)) {
          errors.push({ 
            entity: 'clients', 
            rowIndex: i, 
            column: 'RequestedTaskIDs', 
            message: `Invalid TaskID format: ${taskId} (should be T followed by numbers)`,
            severity: 'error'
          });
        }
      });
    });
  }

  // 7. Circular co-run groups detection (placeholder for future rule validation)
  // This will be implemented when rules are added to the system

  // 8. Overloaded workers validation (AvailableSlots.length < MaxLoadPerPhase)
  if (workers && workers.length > 0) {
    workers.forEach((row, i) => {
      try {
        const slots = JSON.parse(row.AvailableSlots as string);
        const maxLoad = Number(row.MaxLoadPerPhase);
        if (Array.isArray(slots) && maxLoad > slots.length) {
          errors.push({ 
            entity: 'workers', 
            rowIndex: i, 
            column: 'MaxLoadPerPhase', 
            message: `MaxLoadPerPhase (${maxLoad}) exceeds available slots (${slots.length})`,
            severity: 'warning'
          });
        }
      } catch {}
    });
  }

  // 9. Phase-slot saturation validation
  if (workers && workers.length > 0 && tasks && tasks.length > 0) {
    // Get all available phases from workers
    const allPhases = new Set<number>();
    workers.forEach(worker => {
      try {
        const slots = JSON.parse(worker.AvailableSlots as string);
        if (Array.isArray(slots)) {
          slots.forEach(slot => allPhases.add(slot));
        }
      } catch {}
    });

    // Check if total task duration per phase exceeds available worker slots
    allPhases.forEach(phase => {
      const tasksInPhase = tasks.filter(task => {
        const preferredPhases = parsePhases(task.PreferredPhases as string);
        return preferredPhases.includes(phase);
      });
      
      const totalDuration = tasksInPhase.reduce((sum, task) => sum + Number(task.Duration), 0);
      const workersInPhase = workers.filter(worker => {
        try {
          const slots = JSON.parse(worker.AvailableSlots as string);
          return Array.isArray(slots) && slots.includes(phase);
        } catch {
          return false;
        }
      });
      
      const totalSlots = workersInPhase.reduce((sum, worker) => sum + Number(worker.MaxLoadPerPhase), 0);
      
      if (totalDuration > totalSlots) {
        errors.push({ 
          entity: 'tasks', 
          rowIndex: null, 
          column: 'PreferredPhases', 
          message: `Phase ${phase} is oversaturated: ${totalDuration} task durations vs ${totalSlots} available slots`,
          severity: 'warning'
        });
      }
    });
  }

  // 10. Skill-coverage matrix validation
  if (workers && workers.length > 0 && tasks && tasks.length > 0) {
    const allWorkerSkills = new Set<string>();
    workers.forEach(worker => {
      const skills = (worker.Skills as string || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      skills.forEach(skill => allWorkerSkills.add(skill));
    });

    tasks.forEach((task, i) => {
      const requiredSkills = (task.RequiredSkills as string || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      const uncoveredSkills = requiredSkills.filter(skill => !allWorkerSkills.has(skill));
      
      if (uncoveredSkills.length > 0) {
        errors.push({ 
          entity: 'tasks', 
          rowIndex: i, 
          column: 'RequiredSkills', 
          message: `No worker covers required skills: ${uncoveredSkills.join(', ')}`,
          severity: 'error'
        });
      }
    });
  }

  // 11. Max-concurrency feasibility validation
  if (workers && workers.length > 0 && tasks && tasks.length > 0) {
    tasks.forEach((task, i) => {
      const requiredSkills = (task.RequiredSkills as string || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      const qualifiedWorkers = workers.filter(worker => {
        const workerSkills = (worker.Skills as string || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        return requiredSkills.every(skill => workerSkills.includes(skill));
      });
      
      const maxConcurrent = Number(task.MaxConcurrent);
      if (maxConcurrent > qualifiedWorkers.length) {
        errors.push({ 
          entity: 'tasks', 
          rowIndex: i, 
          column: 'MaxConcurrent', 
          message: `MaxConcurrent (${maxConcurrent}) exceeds qualified workers (${qualifiedWorkers.length})`,
          severity: 'warning'
        });
      }
    });
  }

  // 12. PreferredPhases validation
  if (tasks && tasks.length > 0) {
    tasks.forEach((task, i) => {
      const phases = parsePhases(task.PreferredPhases as string);
      if (phases.length === 0) {
        errors.push({ 
          entity: 'tasks', 
          rowIndex: i, 
          column: 'PreferredPhases', 
          message: 'Invalid PreferredPhases format (use JSON array, range like "1-3", or comma-separated list)',
          severity: 'error'
        });
      }
    });
  }

  // 13. Business logic validations based on sample data patterns
  
  // 13.1. GroupTag validation (ensure consistent group naming)
  if (clients && clients.length > 0) {
    const validGroups = new Set(['GroupA', 'GroupB', 'GroupC']);
    clients.forEach((row, i) => {
      const group = row.GroupTag as string;
      if (group && !validGroups.has(group)) {
        errors.push({ 
          entity: 'clients', 
          rowIndex: i, 
          column: 'GroupTag', 
          message: `Invalid GroupTag: ${group} (should be GroupA, GroupB, or GroupC)`,
          severity: 'warning'
        });
      }
    });
  }

  // 13.2. Client name validation (ensure no empty or invalid names)
  if (clients && clients.length > 0) {
    clients.forEach((row, i) => {
      const name = row.ClientName as string;
      if (!name || name.trim().length === 0) {
        errors.push({ 
          entity: 'clients', 
          rowIndex: i, 
          column: 'ClientName', 
          message: 'ClientName cannot be empty',
          severity: 'error'
        });
      }
    });
  }

  // 13.3. Task ID format validation for tasks
  if (tasks && tasks.length > 0) {
    tasks.forEach((row, i) => {
      const taskId = row.TaskID as string;
      if (!isValidTaskID(taskId)) {
        errors.push({ 
          entity: 'tasks', 
          rowIndex: i, 
          column: 'TaskID', 
          message: `Invalid TaskID format: ${taskId} (should be T followed by numbers)`,
          severity: 'error'
        });
      }
    });
  }

  // 13.4. Worker ID format validation
  if (workers && workers.length > 0) {
    workers.forEach((row, i) => {
      const workerId = row.WorkerID as string;
      if (!/^W\d+$/.test(workerId)) {
        errors.push({ 
          entity: 'workers', 
          rowIndex: i, 
          column: 'WorkerID', 
          message: `Invalid WorkerID format: ${workerId} (should be W followed by numbers)`,
          severity: 'error'
        });
      }
    });
  }

  // 13.5. Client ID format validation
  if (clients && clients.length > 0) {
    clients.forEach((row, i) => {
      const clientId = row.ClientID as string;
      if (!/^C\d+$/.test(clientId)) {
        errors.push({ 
          entity: 'clients', 
          rowIndex: i, 
          column: 'ClientID', 
          message: `Invalid ClientID format: ${clientId} (should be C followed by numbers)`,
          severity: 'error'
        });
      }
    });
  }

  return errors;
} 