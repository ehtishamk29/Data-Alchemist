// Validation utility for Data Alchemist

export type ValidationError = {
  entity: 'clients' | 'workers' | 'tasks';
  rowIndex: number | null; // null for global errors
  column?: string;
  message: string;
};

export function validateData(
  clients: any[] | null,
  workers: any[] | null,
  tasks: any[] | null
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Missing required columns
  if (clients && clients.length > 0) {
    const requiredClientCols = ['ClientID', 'ClientName', 'PriorityLevel', 'RequestedTaskIDs', 'GroupTag', 'AttributesJSON'];
    requiredClientCols.forEach((col) => {
      if (!Object.keys(clients[0] || {}).includes(col)) {
        errors.push({ entity: 'clients', rowIndex: null, column: col, message: `Missing required column: ${col}` });
      }
    });
    // 2. Duplicate IDs
    const seen = new Set();
    clients.forEach((row, i) => {
      if (seen.has(row.ClientID)) {
        errors.push({ entity: 'clients', rowIndex: i, column: 'ClientID', message: `Duplicate ID: ${row.ClientID}` });
      }
      seen.add(row.ClientID);
    });
    // 4. Out-of-range values (PriorityLevel 1-5)
    clients.forEach((row, i) => {
      const val = Number(row.PriorityLevel);
      if (isNaN(val) || val < 1 || val > 5) {
        errors.push({ entity: 'clients', rowIndex: i, column: 'PriorityLevel', message: 'PriorityLevel must be 1-5' });
      }
    });
    // 5. Broken JSON in AttributesJSON
    clients.forEach((row, i) => {
      try {
        JSON.parse(row.AttributesJSON);
      } catch {
        errors.push({ entity: 'clients', rowIndex: i, column: 'AttributesJSON', message: 'Malformed JSON in AttributesJSON' });
      }
    });
    // 6. Unknown references (RequestedTaskIDs not in tasks)
    if (tasks && tasks.length > 0) {
      const taskIDs = new Set(tasks.map((t) => t.TaskID));
      clients.forEach((row, i) => {
        const ids = (row.RequestedTaskIDs || '').split(',').map((id: string) => id.trim());
        ids.forEach((id: string) => {
          if (id && !taskIDs.has(id)) {
            errors.push({ entity: 'clients', rowIndex: i, column: 'RequestedTaskIDs', message: `Unknown TaskID referenced: ${id}` });
          }
        });
      });
    }
  }

  if (workers && workers.length > 0) {
    const requiredWorkerCols = ['WorkerID', 'WorkerName', 'Skills', 'AvailableSlots', 'MaxLoadPerPhase', 'WorkerGroup', 'QualificationLevel'];
    requiredWorkerCols.forEach((col) => {
      if (!Object.keys(workers[0] || {}).includes(col)) {
        errors.push({ entity: 'workers', rowIndex: null, column: col, message: `Missing required column: ${col}` });
      }
    });
    // 2. Duplicate IDs
    const seen = new Set();
    workers.forEach((row, i) => {
      if (seen.has(row.WorkerID)) {
        errors.push({ entity: 'workers', rowIndex: i, column: 'WorkerID', message: `Duplicate ID: ${row.WorkerID}` });
      }
      seen.add(row.WorkerID);
    });
    // 3. Malformed lists (e.g., non-numeric in AvailableSlots)
    workers.forEach((row, i) => {
      try {
        const slots = JSON.parse(row.AvailableSlots);
        if (!Array.isArray(slots) || slots.some((s: any) => typeof s !== 'number')) {
          errors.push({ entity: 'workers', rowIndex: i, column: 'AvailableSlots', message: 'AvailableSlots must be an array of numbers' });
        }
      } catch {
        errors.push({ entity: 'workers', rowIndex: i, column: 'AvailableSlots', message: 'Malformed AvailableSlots (should be JSON array)' });
      }
    });
    // 8. Overloaded workers (AvailableSlots.length < MaxLoadPerPhase)
    workers.forEach((row, i) => {
      try {
        const slots = JSON.parse(row.AvailableSlots);
        if (Array.isArray(slots) && Number(row.MaxLoadPerPhase) > slots.length) {
          errors.push({ entity: 'workers', rowIndex: i, column: 'MaxLoadPerPhase', message: 'MaxLoadPerPhase exceeds available slots' });
        }
      } catch {}
    });
  }

  if (tasks && tasks.length > 0) {
    const requiredTaskCols = ['TaskID', 'TaskName', 'Category', 'Duration', 'RequiredSkills', 'PreferredPhases', 'MaxConcurrent'];
    requiredTaskCols.forEach((col) => {
      if (!Object.keys(tasks[0] || {}).includes(col)) {
        errors.push({ entity: 'tasks', rowIndex: null, column: col, message: `Missing required column: ${col}` });
      }
    });
    // 2. Duplicate IDs
    const seen = new Set();
    tasks.forEach((row, i) => {
      if (seen.has(row.TaskID)) {
        errors.push({ entity: 'tasks', rowIndex: i, column: 'TaskID', message: `Duplicate ID: ${row.TaskID}` });
      }
      seen.add(row.TaskID);
    });
    // 4. Out-of-range values (Duration >=1)
    tasks.forEach((row, i) => {
      const val = Number(row.Duration);
      if (isNaN(val) || val < 1) {
        errors.push({ entity: 'tasks', rowIndex: i, column: 'Duration', message: 'Duration must be >= 1' });
      }
    });
    // 9. Skill-coverage matrix: every RequiredSkill maps to ≥1 worker
    if (workers && workers.length > 0) {
      const allSkills = new Set(
        workers.flatMap((w) => (w.Skills || '').split(',').map((s: string) => s.trim()))
      );
      tasks.forEach((row, i) => {
        (row.RequiredSkills || '').split(',').map((s: string) => s.trim()).forEach((skill: string) => {
          if (skill && !allSkills.has(skill)) {
            errors.push({ entity: 'tasks', rowIndex: i, column: 'RequiredSkills', message: `No worker covers required skill: ${skill}` });
          }
        });
      });
    }
    // 10. Max-concurrency feasibility: MaxConcurrent ≤ count of qualified, available workers
    if (workers && workers.length > 0) {
      tasks.forEach((row, i) => {
        const requiredSkills = (row.RequiredSkills || '').split(',').map((s: string) => s.trim());
        const qualifiedWorkers = workers.filter((w) =>
          requiredSkills.every((skill: string) => (w.Skills || '').split(',').map((s: string) => s.trim()).includes(skill))
        );
        if (Number(row.MaxConcurrent) > qualifiedWorkers.length) {
          errors.push({ entity: 'tasks', rowIndex: i, column: 'MaxConcurrent', message: 'MaxConcurrent exceeds qualified workers' });
        }
      });
    }
  }

  // 7. Circular co-run groups (A→B→C→A) - Placeholder, as co-run rules are not in data yet

  return errors;
} 