// aiService.ts - AI/NLP abstraction for Data Alchemist

// Type definitions
interface DataRow {
  [key: string]: string | number | boolean | object;
}

interface RuleSuggestion {
  type: string;
  tasks?: string[];
  worker?: string;
  reason: string;
}

interface ParsedRule {
  type: string;
  description?: string;
  tasks?: string[];
}

interface Context {
  clients: DataRow[] | null;
  workers: DataRow[] | null;
  tasks: DataRow[] | null;
}

export async function mapHeaders(headers: string[], entity: 'clients' | 'workers' | 'tasks', apiKey?: string): Promise<string[]> {
  if (apiKey) {
    // TODO: Call OpenAI API to map headers to expected schema
    return headers; // Placeholder
  }
  // Fallback: simple fuzzy/rule-based mapping
  const expected = {
    clients: ['ClientID', 'ClientName', 'PriorityLevel', 'RequestedTaskIDs', 'GroupTag', 'AttributesJSON'],
    workers: ['WorkerID', 'WorkerName', 'Skills', 'AvailableSlots', 'MaxLoadPerPhase', 'WorkerGroup', 'QualificationLevel'],
    tasks: ['TaskID', 'TaskName', 'Category', 'Duration', 'RequiredSkills', 'PreferredPhases', 'MaxConcurrent'],
  }[entity];
  return headers.map(h => {
    const found = expected.find(e => e.toLowerCase() === h.toLowerCase().replace(/\s|_/g, ''));
    return found || h;
  });
}

export async function queryData(query: string, data: DataRow[], apiKey?: string): Promise<DataRow[]> {
  if (apiKey) {
    // TODO: Call OpenAI API to filter data based on query
    return data; // Placeholder
  }
  // Fallback: simple keyword/regex filter
  try {
    if (/duration.*>\s*1/i.test(query)) {
      return data.filter(row => Number(row.Duration) > 1);
    }
    // Generic substring search across all fields
    const q = query.trim().toLowerCase();
    if (q) {
      return data.filter(row =>
        Object.values(row).some(
          v => typeof v === 'string' && v.toLowerCase().includes(q)
        )
      );
    }
  } catch {}
  return data;
}

export async function parseRule(nlRule: string, context: Context, apiKey?: string): Promise<ParsedRule> {
  if (apiKey) {
    // TODO: Call OpenAI API to parse rule
    return { type: 'freeForm', description: nlRule };
  }
  // Fallback: simple pattern matching
  if (/run together/i.test(nlRule)) {
    const tasks = nlRule.match(/T\d+/g) || [];
    return { type: 'coRun', tasks };
  }
  return { type: 'freeForm', description: nlRule };
}

export async function modifyData(nlCommand: string, data: DataRow[], apiKey?: string): Promise<DataRow[]> {
  if (apiKey) {
    // TODO: Call OpenAI API to modify data
    return data; // Placeholder
  }
  // Fallback: simple command parser
  if (/set all prioritylevel to (\d+)/i.test(nlCommand)) {
    const val = nlCommand.match(/set all prioritylevel to (\d+)/i)?.[1];
    if (val) {
      return data.map(row => ({ ...row, PriorityLevel: val }));
    }
  }
  return data;
}

export async function aiRuleRecommendations(clients: DataRow[] | null, workers: DataRow[] | null, tasks: DataRow[] | null, apiKey?: string): Promise<RuleSuggestion[]> {
  if (apiKey) {
    // TODO: Call OpenAI API to suggest rules based on data
    return [];
  }
  // Fallback: improved rule-based suggestions
  const suggestions: RuleSuggestion[] = [];
  // Example: Suggest co-run for tasks requested by the same client
  if (clients && tasks) {
    clients.forEach(client => {
      let requested: string[] = [];
      if (Array.isArray(client.RequestedTaskIDs)) {
        requested = client.RequestedTaskIDs.map((id: string | number) => String(id).trim()).filter(Boolean);
      } else if (typeof client.RequestedTaskIDs === 'string') {
        requested = client.RequestedTaskIDs.split(',').map((id: string) => id.trim()).filter(Boolean);
      }
      if (requested.length > 1) {
        suggestions.push({
          type: 'coRun',
          tasks: requested,
          reason: `Client ${String(client.ClientName || client.ClientID || '')} always requests these tasks together.`
        });
      }
    });
  }
  // Example: Suggest load-limit for overloaded workers
  if (workers) {
    workers.forEach(worker => {
      try {
        let slots = worker.AvailableSlots;
        if (typeof slots === 'string') {
          slots = JSON.parse(slots);
        }
        if (Array.isArray(slots) && Number(worker.MaxLoadPerPhase) > slots.length) {
          suggestions.push({
            type: 'loadLimit',
            worker: String(worker.WorkerName || worker.WorkerID || ''),
            reason: `Worker ${String(worker.WorkerName || worker.WorkerID || '')} is often overloaded.`
          });
        }
      } catch {}
    });
  }
  // Always provide feedback
  if (suggestions.length === 0) {
    suggestions.push({
      type: 'info',
      reason: 'No rule suggestions found for the current data.'
    });
  }
  return suggestions;
} 