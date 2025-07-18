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
  parameters?: Record<string, string | number | boolean>;
}

interface Context {
  clients: DataRow[] | null;
  workers: DataRow[] | null;
  tasks: DataRow[] | null;
}

interface DataCorrection {
  rowIndex: number;
  column: string;
  currentValue: string | number | boolean | object;
  suggestedValue: string | number | boolean | object;
  reason: string;
  confidence: number;
}

// OpenAI API configuration
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Validate OpenAI API key format
function validateApiKey(apiKey: string): boolean {
  return apiKey.startsWith('sk-') && apiKey.length > 20;
}

async function callOpenAI(prompt: string, apiKey: string, systemPrompt?: string): Promise<string> {
  try {
    // Validate API key format first
    if (!validateApiKey(apiKey)) {
      throw new Error('Invalid API key format. Please check your OpenAI API key.');
    }

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt || 'You are a helpful AI assistant for data analysis and validation.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      // Handle specific OpenAI API errors
      if (response.status === 401) {
        throw new Error('Invalid API key. Please check your OpenAI API key and try again.');
      } else if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      } else if (response.status === 400) {
        throw new Error('Invalid request. Please check your input and try again.');
      } else if (response.status === 403) {
        throw new Error('Access denied. Please check your OpenAI account status and billing.');
      } else if (response.status >= 500) {
        throw new Error('OpenAI service is temporarily unavailable. Please try again later.');
      } else {
        const errorMessage = (errorData as { error?: { message?: string } }).error?.message || 'Unknown error';
        throw new Error(`OpenAI API error: ${response.status} - ${errorMessage}`);
      }
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    
    // Re-throw with user-friendly messages
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error('Failed to connect to OpenAI. Please check your internet connection and try again.');
    }
  }
}

export async function mapHeaders(headers: string[], entity: 'clients' | 'workers' | 'tasks', apiKey?: string): Promise<string[]> {
  if (!apiKey) {
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

  try {
    const systemPrompt = `You are an expert data analyst. Map the given headers to the expected schema for ${entity} data. Return only a JSON array of mapped header names in the correct order.`;
    
    const prompt = `Expected headers for ${entity}:
${entity === 'clients' ? 'ClientID, ClientName, PriorityLevel, RequestedTaskIDs, GroupTag, AttributesJSON' :
  entity === 'workers' ? 'WorkerID, WorkerName, Skills, AvailableSlots, MaxLoadPerPhase, WorkerGroup, QualificationLevel' :
  'TaskID, TaskName, Category, Duration, RequiredSkills, PreferredPhases, MaxConcurrent'}

Given headers: ${headers.join(', ')}

Map these headers to the expected schema. Return only a JSON array like: ["ClientID", "ClientName", ...]`;

    const response = await callOpenAI(prompt, apiKey, systemPrompt);
    const mapped = JSON.parse(response);
    return mapped.length === headers.length ? mapped : headers;
  } catch (error) {
    console.error('Header mapping failed:', error);
    return headers;
  }
}

export async function queryData(query: string, data: DataRow[], apiKey?: string): Promise<DataRow[]> {
  if (!query.trim()) {
    return data;
  }

  if (!apiKey) {
    // Fallback: simple keyword/regex filter
    try {
      const q = query.trim().toLowerCase();
      
      // Handle some common natural language patterns
      if (/priority.*high/i.test(query)) {
        return data.filter(row => Number(row.PriorityLevel) >= 4);
      }
      if (/priority.*low/i.test(query)) {
        return data.filter(row => Number(row.PriorityLevel) <= 2);
      }
      if (/duration.*>\s*1/i.test(query)) {
        return data.filter(row => Number(row.Duration) > 1);
      }
      if (/duration.*<\s*3/i.test(query)) {
        return data.filter(row => Number(row.Duration) < 3);
      }
      if (/skills.*python/i.test(query)) {
        return data.filter(row => 
          String(row.Skills || '').toLowerCase().includes('python')
        );
      }
      if (/skills.*javascript/i.test(query)) {
        return data.filter(row => 
          String(row.Skills || '').toLowerCase().includes('javascript')
        );
      }
      
      // Generic substring search across all fields
      if (q) {
        return data.filter(row =>
          Object.values(row).some(
            v => typeof v === 'string' && v.toLowerCase().includes(q)
          )
        );
      }
    } catch (error) {
      console.error('Fallback search failed:', error);
    }
    return data;
  }

  try {
    const systemPrompt = `You are a data filtering expert. Given a natural language query and data, return a JSON array of row indices that match the query. Return only the array of numbers.`;
    
    const prompt = `Query: "${query}"

Data (first 5 rows as example):
${JSON.stringify(data.slice(0, 5), null, 2)}

Return only a JSON array of row indices (0-based) that match the query. For example: [0, 2, 4]`;

    const response = await callOpenAI(prompt, apiKey, systemPrompt);
    const indices = JSON.parse(response);
    
    if (Array.isArray(indices)) {
      return indices.map(i => data[i]).filter(Boolean);
    }
  } catch (error) {
    console.error('Data query failed:', error);
    // Fallback to basic search on error
    const q = query.trim().toLowerCase();
    return data.filter(row =>
      Object.values(row).some(
        v => typeof v === 'string' && v.toLowerCase().includes(q)
      )
    );
  }
  
  return data;
}

export async function parseRule(nlRule: string, context: Context, apiKey?: string): Promise<ParsedRule> {
  if (!apiKey) {
    // Fallback: simple pattern matching
    if (/run together/i.test(nlRule)) {
      const tasks = nlRule.match(/T\d+/g) || [];
      return { type: 'coRun', tasks };
    }
    return { type: 'freeForm', description: nlRule };
  }

  try {
    const systemPrompt = `You are a business rule parser. Convert natural language rules to structured format. Return only a JSON object with type, description, and parameters.`;
    
    const prompt = `Convert this natural language rule to a structured format:
"${nlRule}"

Available data context:
- Clients: ${context.clients?.length || 0} records
- Workers: ${context.workers?.length || 0} records  
- Tasks: ${context.tasks?.length || 0} records

Return only a JSON object like:
{
  "type": "coRun|loadLimit|slotRestriction|phaseWindow|patternMatch",
  "description": "Human readable description",
  "tasks": ["T1", "T2"],
  "parameters": { "maxSlots": 5 }
}`;

    const response = await callOpenAI(prompt, apiKey, systemPrompt);
    return JSON.parse(response);
  } catch (error) {
    console.error('Rule parsing failed:', error);
    return { type: 'freeForm', description: nlRule };
  }
}

export async function modifyData(nlCommand: string, data: DataRow[], apiKey?: string): Promise<DataRow[]> {
  if (!nlCommand.trim()) {
    return data;
  }

  if (!apiKey) {
    // Fallback: simple command parser
    try {
      // Handle common modification patterns
      if (/set all prioritylevel to (\d+)/i.test(nlCommand)) {
        const val = nlCommand.match(/set all prioritylevel to (\d+)/i)?.[1];
        if (val) {
          return data.map(row => ({ ...row, PriorityLevel: Number(val) }));
        }
      }
      
      if (/set all.*priority.*to (\d+)/i.test(nlCommand)) {
        const val = nlCommand.match(/set all.*priority.*to (\d+)/i)?.[1];
        if (val) {
          return data.map(row => ({ ...row, PriorityLevel: Number(val) }));
        }
      }
      
      if (/increase.*priority/i.test(nlCommand)) {
        return data.map(row => ({ 
          ...row, 
          PriorityLevel: Math.min(5, Number(row.PriorityLevel || 1) + 1) 
        }));
      }
      
      if (/decrease.*priority/i.test(nlCommand)) {
        return data.map(row => ({ 
          ...row, 
          PriorityLevel: Math.max(1, Number(row.PriorityLevel || 1) - 1) 
        }));
      }
      
      if (/set.*group.*to (.+)/i.test(nlCommand)) {
        const group = nlCommand.match(/set.*group.*to (.+)/i)?.[1];
        if (group) {
          return data.map(row => ({ ...row, GroupTag: group.trim() }));
        }
      }
      
      console.warn('No matching modification pattern found for:', nlCommand);
      return data;
    } catch (error) {
      console.error('Fallback modification failed:', error);
      return data;
    }
  }

  try {
    const systemPrompt = `You are a data modification expert. Given a natural language command and data, return the modified data as a JSON array. Return only the JSON array.`;
    
    const prompt = `Command: "${nlCommand}"

Current data (first 3 rows as example):
${JSON.stringify(data.slice(0, 3), null, 2)}

Apply the command to all data and return the complete modified dataset as a JSON array.`;

    const response = await callOpenAI(prompt, apiKey, systemPrompt);
    const modified = JSON.parse(response);
    
    if (Array.isArray(modified) && modified.length === data.length) {
      return modified;
    }
  } catch (error) {
    console.error('Data modification failed:', error);
    // Fallback to basic modification on error
    return data;
  }
  
  return data;
}

export async function aiRuleRecommendations(clients: DataRow[] | null, workers: DataRow[] | null, tasks: DataRow[] | null, apiKey?: string): Promise<RuleSuggestion[]> {
  if (!apiKey) {
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
    
    if (suggestions.length === 0) {
      suggestions.push({
        type: 'info',
        reason: 'No rule suggestions found for the current data.'
      });
    }
    return suggestions;
  }

  try {
    const systemPrompt = `You are an expert business analyst. Analyze the data and suggest relevant business rules. Return only a JSON array of rule suggestions.`;
    
    const prompt = `Analyze this data and suggest business rules:

Clients: ${JSON.stringify(clients?.slice(0, 3), null, 2)}
Workers: ${JSON.stringify(workers?.slice(0, 3), null, 2)}
Tasks: ${JSON.stringify(tasks?.slice(0, 3), null, 2)}

Suggest relevant business rules based on patterns in the data. Return only a JSON array like:
[
  {
    "type": "coRun|loadLimit|slotRestriction|phaseWindow",
    "tasks": ["T1", "T2"],
    "worker": "WorkerName",
    "reason": "Explanation of why this rule is suggested"
  }
]`;

    const response = await callOpenAI(prompt, apiKey, systemPrompt);
    return JSON.parse(response);
  } catch (error) {
    console.error('AI rule recommendations failed:', error);
    return [{
      type: 'info',
      reason: 'Unable to generate AI rule suggestions at this time.'
    }];
  }
}

export async function suggestDataCorrections(data: DataRow[], entity: 'clients' | 'workers' | 'tasks', apiKey?: string): Promise<DataCorrection[]> {
  if (!apiKey) {
    return [];
  }

  try {
    const systemPrompt = `You are a data quality expert. Analyze the data for potential errors and suggest corrections. Return only a JSON array of corrections.`;
    
    const prompt = `Analyze this ${entity} data for potential errors and suggest corrections:

${JSON.stringify(data.slice(0, 5), null, 2)}

Look for:
- Invalid formats (IDs, numbers, JSON)
- Out-of-range values
- Missing required fields
- Inconsistent data patterns

Return only a JSON array like:
[
  {
    "rowIndex": 0,
    "column": "PriorityLevel", 
    "currentValue": "6",
    "suggestedValue": "5",
    "reason": "PriorityLevel should be 1-5",
    "confidence": 0.9
  }
]`;

    const response = await callOpenAI(prompt, apiKey, systemPrompt);
    return JSON.parse(response);
  } catch (error) {
    console.error('Data correction suggestions failed:', error);
    return [];
  }
}

export async function validateDataWithAI(data: DataRow[], entity: 'clients' | 'workers' | 'tasks', apiKey?: string): Promise<{ field: string; message: string; severity: 'error' | 'warning' }[]> {
  if (!apiKey) {
    return [];
  }

  try {
    const systemPrompt = `You are a data validation expert. Analyze the data for validation issues. Return only a JSON array of validation errors/warnings.`;
    
    const prompt = `Validate this ${entity} data:

${JSON.stringify(data.slice(0, 5), null, 2)}

Check for:
- Data type mismatches
- Business logic violations
- Format inconsistencies
- Missing dependencies

Return only a JSON array like:
[
  {
    "field": "PriorityLevel",
    "message": "Value 6 is out of range (1-5)",
    "severity": "error"
  }
]`;

    const response = await callOpenAI(prompt, apiKey, systemPrompt);
    return JSON.parse(response);
  } catch (error) {
    console.error('AI validation failed:', error);
    return [];
  }
}