import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// --- TYPE DEFINITIONS ---
interface Category {
  id: string;
  name: string;
  keywords: string[];
}

interface Categories {
  income: Category[];
  expense: Category[];
}

interface Transaction {
  id:string;
  date: string;
  description: string;
  amount: number;
  category: string;
  ignored: boolean;
}

interface StagedTransaction extends Transaction {
}

type NumberFormat = 'eur' | 'usa';
type AppState = 'welcome' | 'tracker';
type TrackerView = 'import' | 'transactions' | 'categories' | 'how-it-works';
type CategoryType = 'income' | 'expense';

// --- HELPER FUNCTIONS ---
const normalizeString = (str: string): string => {
    if (!str) return '';
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
};

const parseDate = (dateValue: any): string => {
    if (!dateValue) return 'Invalid Date';

    // Handle Excel's numeric date format
    if (typeof dateValue === 'number') {
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
        // Basic timezone offset correction
        const userTimezoneOffset = date.getTimezoneOffset() * 60000;
        const correctedDate = new Date(date.getTime() + userTimezoneOffset);
        if (!isNaN(correctedDate.getTime())) {
            return correctedDate.toLocaleDateString('es-ES');
        }
    }
    
    // Handle string dates
    if (typeof dateValue === 'string') {
        // Attempt to parse various common formats
        const date = new Date(dateValue.split('/').reverse().join('-')); // DD/MM/YYYY
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('es-ES');
        }
    }

    // Fallback for standard date objects or other parsable formats
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('es-ES');
    }

    return 'Invalid Date';
};

const parseAmount = (numStr: string, format: NumberFormat): number => {
    if (numStr === null || numStr === undefined) return 0;

    const cleanedStr = String(numStr).replace(/[^\d.,-]/g, '').trim();

    if (!cleanedStr || cleanedStr === '-') return 0;

    let parsableStr = cleanedStr;

    if (format === 'eur') {
        // European format: 1.234,56 or 1234,56 -> 1234.56
        const hasDot = cleanedStr.includes('.');
        const hasComma = cleanedStr.includes(',');

        if (hasDot && hasComma) {
            // Both present: dots are thousands, comma is decimal -> 1.234,56
            parsableStr = cleanedStr.replace(/\./g, '').replace(/,/g, '.');
        } else if (hasComma) {
            // Only comma: it's the decimal separator -> 1234,56
            parsableStr = cleanedStr.replace(/,/g, '.');
        } else {
            // Only dot or neither: treat as-is -> 1234.56 or 1234
            parsableStr = cleanedStr;
        }
    } else { // 'usa'
        // American format: 1,234.56 or 1234.56 -> 1234.56
        const hasDot = cleanedStr.includes('.');
        const hasComma = cleanedStr.includes(',');

        if (hasDot && hasComma) {
            // Both present: commas are thousands, dot is decimal -> 1,234.56
            parsableStr = cleanedStr.replace(/,/g, '');
        } else if (hasComma) {
            // Only comma: remove it (thousand separator) -> 1,234
            parsableStr = cleanedStr.replace(/,/g, '');
        } else {
            // Only dot or neither: treat as-is -> 1234.56 or 1234
            parsableStr = cleanedStr;
        }
    }

    const result = parseFloat(parsableStr);
    return isNaN(result) ? 0 : result;
};

const getSortableTime = (dateString: string): number => {
    if (!dateString || typeof dateString !== 'string') return 0;
    const parts = dateString.split('/');
    if (parts.length !== 3) return 0; // Invalid format
    // Format is DD/MM/YYYY, so we construct as YYYY-MM-DD for Date object
    const isoDateString = `${parts[2]}-${parts[1]}-${parts[0]}`;
    const date = new Date(isoDateString);
    if (isNaN(date.getTime())) return 0; // Invalid date
    return date.getTime();
}

// FIX: Moved `formatDateForInput` outside the component to fix block-scoped variable error.
const formatDateForInput = (date: Date): string => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const autoCategorizeTransaction = (description: string, categories: Categories): string => {
    const allKeywords = [
        ...categories.income.flatMap(c => 
            [c.name, ...c.keywords].map(k => ({ keyword: k, category: c.name }))
        ),
        ...categories.expense.flatMap(c => 
            [c.name, ...c.keywords].map(k => ({ keyword: k, category: c.name }))
        )
    ];

    // Sort by keyword length, descending. Longer, more specific keywords get checked first.
    allKeywords.sort((a, b) => (b.keyword || '').length - (a.keyword || '').length);

    const normalizedDescription = normalizeString(description);

    const getVariations = (keyword: string): string[] => {
        const normalized = normalizeString(keyword);
        const forms = [normalized];
        // Heuristic for simple Spanish plurals
        if (normalized.endsWith('es') && normalized.length > 3) {
            forms.push(normalized.slice(0, -2)); // e.g., 'meses' -> 'mes'
        } else if (normalized.endsWith('s') && normalized.length > 3) {
            forms.push(normalized.slice(0, -1)); // e.g., 'restaurantes' -> 'restaurante'
        }
        return [...new Set(forms)]; // Return unique variations to avoid redundant checks
    };

    // Pass 1: Whole-word matching for higher precision.
    for (const { keyword, category } of allKeywords) {
        if (!keyword) continue; // Skip empty keywords
        
        const variations = getVariations(keyword);
        for (const variation of variations) {
            if (!variation) continue;
            const escapedKeyword = variation.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedKeyword}\\b`);
            if (regex.test(normalizedDescription)) {
                return category;
            }
        }
    }
    
    // Pass 2: Fallback to `includes` for partial matches, still respecting priority.
    for (const { keyword, category } of allKeywords) {
        if (!keyword) continue;

        const variations = getVariations(keyword);
        for (const variation of variations) {
            if (!variation) continue;
            if (normalizedDescription.includes(variation)) {
                return category;
            }
        }
    }

    return ''; // No match found
};


// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    // --- STATE MANAGEMENT ---
    const [appState, setAppState] = useState<AppState>('welcome');
    const [tracker_view, setTrackerView] = useState<TrackerView>('import');
    
    const [categories, setCategories] = useState<Categories>({ income: [], expense: [] });
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    
    // Import process state
    const [fileHeaders, setFileHeaders] = useState<string[]>([]);
    const [filePreview, setFilePreview] = useState<any[][]>([]);
    const [parsedData, setParsedData] = useState<any[]>([]);
    const [mappedColumns, setMappedColumns] = useState({ date: '', description: '', amount: '' });
    const [numberFormat, setNumberFormat] = useState<NumberFormat>('eur');
    const [stagedTransactions, setStagedTransactions] = useState<StagedTransaction[]>([]);
    
    const [editingCategory, setEditingCategory] = useState<string | null>(null);

    // Filters State
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [startDateFilter, setStartDateFilter] = useState<string>('');
    const [endDateFilter, setEndDateFilter] = useState<string>('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- EFFECTS (LIFECYCLE) ---
    useEffect(() => {
        // This effect just checks for saved data on mount to enable the 'Continue' button.
        // It doesn't need to do anything, the check is synchronous.
    }, []);

    useEffect(() => {
        if (appState === 'tracker') {
            const dataToSave = JSON.stringify({ transactions, categories });
            localStorage.setItem('finanzasNudistaSession', dataToSave);
        }
    }, [transactions, categories, appState]);

    // --- HANDLERS: SESSION & NAVIGATION ---
    const hasSavedSession = (): boolean => !!localStorage.getItem('finanzasNudistaSession');

    const handleNewSession = () => {
        setCategories({ income: [], expense: [] });
        setTransactions([]);
        setStagedTransactions([]);
        setAppState('tracker');
        setTrackerView('import');
    };

    const handleContinueSession = () => {
        const savedData = localStorage.getItem('finanzasNudistaSession');
        if (savedData) {
            const { transactions, categories } = JSON.parse(savedData);
            // FIX: Ensure all transactions have an 'ignored' property and that 'amount' is a number for backwards compatibility.
            // This prevents type errors in calculations when data is loaded from localStorage.
            const hydratedTransactions = (transactions || []).map((t: any) => ({ ...t, amount: Number(t.amount) || 0, ignored: t.ignored || false }));
            setTransactions(hydratedTransactions);
            setCategories(categories || { income: [], expense: [] });
        }
        setAppState('tracker');
        setTrackerView('transactions');
    };

    const handleClearSession = () => {
        localStorage.removeItem('finanzasNudistaSession');
        setAppState('welcome'); // Force re-render of welcome screen
    };

    const handleGoToWelcome = () => {
        setAppState('welcome');
        setStagedTransactions([]);
    };
    
    // --- HANDLERS: FILE IMPORT ---
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array', codepage: 65001 }); // Use UTF-8 codepage
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: null });
            
            let headerRowIndex = -1;
            let headers: string[] = [];
            const commonHeaders = ['fecha', 'descripcion', 'concepto', 'importe', 'valor', 'cantidad'];
            for (let i = 0; i < Math.min(20, jsonData.length); i++) {
                const row = jsonData[i].map(h => String(h || '').toLowerCase().trim());
                const score = row.filter(cell => commonHeaders.some(ch => cell.includes(ch))).length;
                if (score >= 2) {
                    headerRowIndex = i;
                    headers = jsonData[i].map(h => String(h || ''));
                    break;
                }
            }
            if (headerRowIndex === -1) {
              headerRowIndex = 0;
              headers = jsonData[0].map(h => String(h || ''));
            }

            const dataRows = jsonData.slice(headerRowIndex + 1);

            setFileHeaders(headers);
            setParsedData(dataRows);
            setFilePreview(dataRows.slice(0, 3));
            
            const autoMapped = { date: '', description: '', amount: ''};
            headers.forEach(header => {
                const h = header.toLowerCase();
                if (!autoMapped.date && (h.includes('fecha') || h.includes('date'))) autoMapped.date = header;
                if (!autoMapped.description && (h.includes('descrip') || h.includes('concepto'))) autoMapped.description = header;
                if (!autoMapped.amount && (h.includes('importe') || h.includes('valor') || h.includes('cantidad'))) autoMapped.amount = header;
            });
            setMappedColumns(autoMapped);
            
        } catch (error) {
            console.error(error);
            alert("Hubo un error al procesar el archivo. Asegúrate de que es un CSV o Excel válido.");
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };
    
    const handleProcessMappedFile = () => {
        const newTransactions = parsedData.map((row, index) => {
            const date = parseDate(row[fileHeaders.indexOf(mappedColumns.date)]);
            const description = String(row[fileHeaders.indexOf(mappedColumns.description)] || '');
            const rawAmount = String(row[fileHeaders.indexOf(mappedColumns.amount)] || '0');
            const amount = parseAmount(rawAmount, numberFormat);
            
            return {
                id: `staged-${Date.now()}-${index}`,
                date,
                description,
                amount,
                category: '',
                ignored: false,
            };
        }).filter(t => t.description && t.amount !== 0);

        const autoCategorized = newTransactions.map(t => {
            const foundCategory = autoCategorizeTransaction(t.description, categories);
            return { ...t, category: foundCategory || '' };
        });

        setStagedTransactions(prev => [...prev, ...autoCategorized]);
        setParsedData([]);
        setFileHeaders([]);
        setFilePreview([]);
    };
    
    const handleFinalizeStaging = () => {
        setTransactions(prev => [...prev, ...stagedTransactions]);
        setStagedTransactions([]);
        setTrackerView('transactions');
    };
    
    // --- HANDLERS: CATEGORIES ---
    const addCategory = (type: CategoryType, name: string) => {
        if (!name.trim()) return;
        const newCategory: Category = { id: `cat-${Date.now()}`, name: name.trim(), keywords: [] };
        setCategories(prev => ({ ...prev, [type]: [...prev[type], newCategory] }));
    };

    const deleteCategory = (type: CategoryType, id: string) => {
        setCategories(prev => ({ ...prev, [type]: prev[type].filter(c => c.id !== id) }));
    };
    
    const addKeyword = (type: CategoryType, categoryId: string, keyword: string) => {
        if (!keyword.trim()) return;
        setCategories(prev => ({ ...prev, [type]: prev[type].map(c => c.id === categoryId ? { ...c, keywords: [...c.keywords, keyword.trim()] } : c) }));
    };

    const removeKeyword = (type: CategoryType, categoryId: string, keyword: string) => {
        setCategories(prev => ({ ...prev, [type]: prev[type].map(c => c.id === categoryId ? { ...c, keywords: c.keywords.filter(k => k !== keyword) } : c) }));
    };
    
    // --- HANDLERS: TRANSACTIONS (STAGING & MAIN) ---
    const updateStagedTransaction = (id: string, newValues: Partial<StagedTransaction>) => {
        setStagedTransactions(prev => prev.map(t => t.id === id ? { ...t, ...newValues } : t));
    };

    const updateTransaction = (id: string, newValues: Partial<Transaction>) => {
        setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...newValues } : t));
    };

    const addTransaction = (transactionData: Omit<Transaction, 'id' | 'ignored'>) => {
        const newTransaction: Transaction = {
            ...transactionData,
            id: `manual-${Date.now()}`,
            ignored: false,
        };
        setTransactions(prev => [newTransaction, ...prev]);
    };
    
    const deleteStagedTransaction = (id: string) => {
        setStagedTransactions(prev => prev.filter(t => t.id !== id));
    };

    const handleAutoCategorize = () => {
        const updatedTransactions = transactions.map(t => {
            if (!t.category) { // Only categorize if uncategorized
                const foundCategory = autoCategorizeTransaction(t.description, categories);
                if (foundCategory) {
                    return { ...t, category: foundCategory };
                }
            }
            return t;
        });
        setTransactions(updatedTransactions);
    };

    // --- RENDER LOGIC ---
    if (appState === 'welcome') {
        return <WelcomeScreen onNew={handleNewSession} onContinue={handleContinueSession} hasSession={hasSavedSession()} onClear={handleClearSession} />;
    }
    
    const allCategories = [...categories.income, ...categories.expense];

    const filteredTransactions = transactions
        .filter(t => {
            const transactionDate = getSortableTime(t.date);
            const startDate = startDateFilter ? new Date(startDateFilter).getTime() : 0;
            const endDate = endDateFilter ? new Date(endDateFilter).getTime() : Infinity;
            
            const isDateInRange = transactionDate >= startDate && transactionDate <= endDate;
            const isCategoryMatch = categoryFilter === 'all' || t.category === categoryFilter || (categoryFilter === 'uncategorized' && !t.category);
            
            return isDateInRange && isCategoryMatch;
        })
        .sort((a, b) => getSortableTime(b.date) - getSortableTime(a.date));

    // --- RENDER ---
    return (
        <div className="app-container">
            <AppHeader onGoToWelcome={handleGoToWelcome} activeView={tracker_view} onNavigate={setTrackerView} />
            <main className="app-content">
                {tracker_view === 'import' && 
                    <ImportView
                        onFileChange={handleFileChange}
                        fileInputRef={fileInputRef}
                        fileHeaders={fileHeaders}
                        filePreview={filePreview}
                        mappedColumns={mappedColumns}
                        setMappedColumns={setMappedColumns}
                        numberFormat={numberFormat}
                        setNumberFormat={setNumberFormat}
                        onProcessFile={handleProcessMappedFile}
                        stagedTransactions={stagedTransactions}
                        onUpdateStaged={updateStagedTransaction}
                        onDeleteStaged={deleteStagedTransaction}
                        onFinalize={handleFinalizeStaging}
                        allCategories={allCategories.map(c => c.name)}
                    />
                }
                {tracker_view === 'transactions' && 
                    <TransactionsView 
                        transactions={filteredTransactions} 
                        onUpdateTransaction={updateTransaction}
                        onAddTransaction={addTransaction}
                        onAutoCategorize={handleAutoCategorize}
                        allCategories={allCategories.map(c => c.name)}
                        categoryFilter={categoryFilter}
                        setCategoryFilter={setCategoryFilter}
                        startDateFilter={startDateFilter}
                        setStartDateFilter={setStartDateFilter}
                        endDateFilter={endDateFilter}
                        setEndDateFilter={setEndDateFilter}
                    />
                }
                {tracker_view === 'categories' && 
                    <CategoriesView 
                        categories={categories}
                        onAddCategory={addCategory}
                        onDeleteCategory={deleteCategory}
                        onAddKeyword={addKeyword}
                        onRemoveKeyword={removeKeyword}
                        editingCategory={editingCategory}
                        setEditingCategory={setEditingCategory}
                    />
                }
                {tracker_view === 'how-it-works' &&
                    <HowItWorksView />
                }
            </main>
        </div>
    );
};

// --- SUB-COMPONENTS ---

// --- Welcome Screen Component ---
interface WelcomeScreenProps {
    onNew: () => void;
    onContinue: () => void;
    hasSession: boolean;
    onClear: () => void;
}
const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onNew, onContinue, hasSession, onClear }) => {
    return (
        <div className="welcome-container">
            <img src="https://nudistainvestor.com/wp-content/uploads/2025/10/nudsita-need-you.png" alt="Nudistracker Logo" className="welcome-logo-main" />
            <div className="welcome-content">
                <div className="welcome-card">
                    <h2>Bienvenido a Nudistracker</h2>
                    <p>La forma más sencilla de entender tus finanzas.</p>
                    <div className="instructions">
                        <h4>Cómo empezar:</h4>
                        <ol className="instructions-list">
                            <li>Exporta tus movimientos bancarios a un archivo CSV o Excel.</li>
                            <li>Haz clic en "Nueva Sesión" e importa tu archivo.</li>
                            <li>¡Visualiza, categoriza y entiende a dónde va tu dinero!</li>
                        </ol>
                    </div>
                    {hasSession && (
                         <div className="session-notice">
                            <p>Hemos detectado una sesión guardada. Puedes continuar donde lo dejaste o empezar de nuevo (esto borrará tus datos anteriores).</p>
                        </div>
                    )}
                    <div className="session-actions">
                        <button className="button primary" onClick={onNew}>Nueva Sesión</button>
                        {hasSession && <button className="button" onClick={onContinue}>Continuar Sesión</button>}
                    </div>
                    {hasSession && <button className="button text-danger" onClick={onClear}>Borrar datos y empezar de cero</button>}
                </div>
            </div>
        </div>
    );
};

// --- App Header Component ---
interface AppHeaderProps {
    onGoToWelcome: () => void;
    activeView: TrackerView;
    onNavigate: (view: TrackerView) => void;
}
const AppHeader: React.FC<AppHeaderProps> = ({ onGoToWelcome, activeView, onNavigate }) => {
    return (
        <header className="app-header">
            <div className="app-logo-title" onClick={onGoToWelcome}>
                <h1>Nudistracker</h1>
            </div>
            <nav>
                <button className={activeView === 'transactions' ? 'active' : ''} onClick={() => onNavigate('transactions')}>Movimientos</button>
                <button className={activeView === 'categories' ? 'active' : ''} onClick={() => onNavigate('categories')}>Categorías</button>
                <button className={activeView === 'import' ? 'active' : ''} onClick={() => onNavigate('import')}>Importar</button>
                <button className={activeView === 'how-it-works' ? 'active' : ''} onClick={() => onNavigate('how-it-works')}>Cómo funciona</button>
            </nav>
        </header>
    );
};

// --- Import View Component ---
interface ImportViewProps {
    onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    fileInputRef: React.RefObject<HTMLInputElement>;
    fileHeaders: string[];
    filePreview: any[][];
    mappedColumns: { date: string; description: string; amount: string; };
    setMappedColumns: React.Dispatch<React.SetStateAction<{ date: string; description: string; amount: string; }>>;
    numberFormat: NumberFormat;
    setNumberFormat: (format: NumberFormat) => void;
    onProcessFile: () => void;
    stagedTransactions: StagedTransaction[];
    onUpdateStaged: (id: string, newValues: Partial<StagedTransaction>) => void;
    onDeleteStaged: (id: string) => void;
    onFinalize: () => void;
    allCategories: string[];
}

const ImportView: React.FC<ImportViewProps> = ({ onFileChange, fileInputRef, fileHeaders, filePreview, mappedColumns, setMappedColumns, numberFormat, setNumberFormat, onProcessFile, stagedTransactions, onUpdateStaged, onDeleteStaged, onFinalize, allCategories }) => {

    const isMappingComplete = mappedColumns.date && mappedColumns.description && mappedColumns.amount;
    const hasStagedTransactions = stagedTransactions.length > 0;
    
    const handleTriggerFileInput = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className="import-view">
            <div className="panel">
                <h2>Importar Movimientos</h2>
                <p>Sube tu archivo CSV o Excel para empezar a organizar tus transacciones. </p>
                <input type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={onFileChange} ref={fileInputRef} style={{ display: 'none' }} />
                <button className="button primary" onClick={handleTriggerFileInput}>
                    <UploadIcon />
                    Seleccionar Archivo
                </button>
            </div>

            {fileHeaders.length > 0 && (
                <div className="panel column-mapping-panel">
                    <h3>Paso 2: Mapea tus columnas</h3>
                    <p>Indica qué columnas de tu archivo corresponden a la fecha, descripción e importe.</p>
                    <div className="column-selectors">
                        <div className="selector-group">
                            <label htmlFor="date-col">Fecha</label>
                            <select id="date-col" value={mappedColumns.date} onChange={e => setMappedColumns(prev => ({ ...prev, date: e.target.value }))}>
                                <option value="">Selecciona una columna</option>
                                {fileHeaders.map(h => <option key={`date-${h}`} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div className="selector-group">
                            <label htmlFor="desc-col">Descripción / Concepto</label>
                            <select id="desc-col" value={mappedColumns.description} onChange={e => setMappedColumns(prev => ({ ...prev, description: e.target.value }))}>
                                <option value="">Selecciona una columna</option>
                                {fileHeaders.map(h => <option key={`desc-${h}`} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div className="selector-group">
                            <label htmlFor="amount-col">Importe</label>
                            <select id="amount-col" value={mappedColumns.amount} onChange={e => setMappedColumns(prev => ({ ...prev, amount: e.target.value }))}>
                                <option value="">Selecciona una columna</option>
                                {fileHeaders.map(h => <option key={`amount-${h}`} value={h}>{h}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="number-format-selector">
                        <h4>Formato de los números</h4>
                        <div className="radio-group">
                            <label>
                                <input type="radio" name="number-format" value="eur" checked={numberFormat === 'eur'} onChange={() => setNumberFormat('eur')} />
                                <span>1.234,56 (Punto para miles, coma para decimales)</span>
                            </label>
                            <label>
                                <input type="radio" name="number-format" value="usa" checked={numberFormat === 'usa'} onChange={() => setNumberFormat('usa')} />
                                <span>1,234.56 (Coma para miles, punto para decimales)</span>
                            </label>
                        </div>
                    </div>

                    {filePreview.length > 0 && (
                        <div className="preview-section">
                            <h4>Vista previa</h4>
                            <div className="table-container">
                                <table className="preview-table">
                                    <thead>
                                        <tr>
                                            {fileHeaders.map((h, i) => <th key={i}>{h}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filePreview.map((row, i) => (
                                            <tr key={i}>
                                                {row.map((cell, j) => <td key={j}>{String(cell || '')}</td>)}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <button className="button primary" onClick={onProcessFile} disabled={!isMappingComplete}>
                        Procesar Archivo
                    </button>
                </div>
            )}

            {hasStagedTransactions && (
                <div className="panel staged-transactions-panel">
                    <h3>Transacciones Importadas ({stagedTransactions.length})</h3>
                    <p>Revisa y ajusta las transacciones antes de añadirlas a tu registro.</p>
                    <div className="table-container">
                        <table className="staged-table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Descripción</th>
                                    <th>Importe</th>
                                    <th>Categoría</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stagedTransactions.map(t => (
                                    <tr key={t.id}>
                                        <td>{t.date}</td>
                                        <td>
                                            <input
                                                type="text"
                                                value={t.description}
                                                onChange={e => onUpdateStaged(t.id, { description: e.target.value })}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="number"
                                                value={t.amount}
                                                onChange={e => onUpdateStaged(t.id, { amount: parseFloat(e.target.value) || 0 })}
                                            />
                                        </td>
                                        <td>
                                            <select
                                                value={t.category}
                                                onChange={e => onUpdateStaged(t.id, { category: e.target.value })}
                                            >
                                                <option value="">Sin categoría</option>
                                                {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                            </select>
                                        </td>
                                        <td>
                                            <button className="button-icon danger" onClick={() => onDeleteStaged(t.id)}>
                                                <DeleteIcon />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button className="button primary" onClick={onFinalize}>
                        Finalizar y Añadir Transacciones
                    </button>
                </div>
            )}
        </div>
    );
};

// --- Transactions View Component ---
interface TransactionsViewProps {
    transactions: Transaction[];
    onUpdateTransaction: (id: string, newValues: Partial<Transaction>) => void;
    onAddTransaction: (transactionData: Omit<Transaction, 'id' | 'ignored'>) => void;
    onAutoCategorize: () => void;
    allCategories: string[];
    categoryFilter: string;
    setCategoryFilter: (value: string) => void;
    startDateFilter: string;
    setStartDateFilter: (value: string) => void;
    endDateFilter: string;
    setEndDateFilter: (value: string) => void;
}

const TransactionsView: React.FC<TransactionsViewProps> = ({ transactions, onUpdateTransaction, onAddTransaction, onAutoCategorize, allCategories, categoryFilter, setCategoryFilter, startDateFilter, setStartDateFilter, endDateFilter, setEndDateFilter }) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [newTransactionData, setNewTransactionData] = useState({ date: '', description: '', amount: 0, category: '' });

    const handleAdd = () => {
        if (!newTransactionData.date || !newTransactionData.description) {
            alert('Por favor completa al menos la fecha y la descripción.');
            return;
        }
        onAddTransaction(newTransactionData);
        setNewTransactionData({ date: '', description: '', amount: 0, category: '' });
        setShowAddForm(false);
    };

    const activeTransactions = transactions.filter(t => !t.ignored);
    const ignoredTransactions = transactions.filter(t => t.ignored);

    const totalIncome = activeTransactions.filter(t => t.amount > 0).reduce((acc, t) => acc + t.amount, 0);
    const totalExpense = activeTransactions.filter(t => t.amount < 0).reduce((acc, t) => acc + Math.abs(t.amount), 0);
    const balance = totalIncome - totalExpense;

    return (
        <div className="transactions-view">
            <div className="panel summary-panel">
                <h2>Resumen Financiero</h2>
                <div className="summary-cards">
                    <div className="summary-card income">
                        <span className="summary-label">Ingresos</span>
                        <span className="summary-value">€{totalIncome.toFixed(2)}</span>
                    </div>
                    <div className="summary-card expense">
                        <span className="summary-label">Gastos</span>
                        <span className="summary-value">€{totalExpense.toFixed(2)}</span>
                    </div>
                    <div className={`summary-card balance ${balance >= 0 ? 'positive' : 'negative'}`}>
                        <span className="summary-label">Balance</span>
                        <span className="summary-value">€{balance.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div className="panel">
                <div className="panel-header">
                    <h3>Tus Movimientos</h3>
                    <div className="header-actions">
                        <button className="button" onClick={onAutoCategorize}>Auto-categorizar</button>
                        <button className="button primary" onClick={() => setShowAddForm(true)}>Añadir Transacción</button>
                    </div>
                </div>

                {showAddForm && (
                    <div className="add-form">
                        <h4>Nueva Transacción</h4>
                        <div className="form-row">
                            <input type="date" value={newTransactionData.date} onChange={e => setNewTransactionData(prev => ({ ...prev, date: e.target.value }))} />
                            <input type="text" placeholder="Descripción" value={newTransactionData.description} onChange={e => setNewTransactionData(prev => ({ ...prev, description: e.target.value }))} />
                            <input type="number" placeholder="Importe" value={newTransactionData.amount} onChange={e => setNewTransactionData(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))} />
                            <select value={newTransactionData.category} onChange={e => setNewTransactionData(prev => ({ ...prev, category: e.target.value }))}>
                                <option value="">Sin categoría</option>
                                {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                        </div>
                        <div className="form-actions">
                            <button className="button primary" onClick={handleAdd}>Añadir</button>
                            <button className="button" onClick={() => setShowAddForm(false)}>Cancelar</button>
                        </div>
                    </div>
                )}

                <div className="filters">
                    <div className="filter-group">
                        <label htmlFor="category-filter">Filtrar por categoría:</label>
                        <select id="category-filter" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                            <option value="all">Todas</option>
                            <option value="uncategorized">Sin categorizar</option>
                            {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                    </div>
                    <div className="filter-group">
                        <label htmlFor="start-date">Desde:</label>
                        <input id="start-date" type="date" value={startDateFilter} onChange={e => setStartDateFilter(e.target.value)} />
                    </div>
                    <div className="filter-group">
                        <label htmlFor="end-date">Hasta:</label>
                        <input id="end-date" type="date" value={endDateFilter} onChange={e => setEndDateFilter(e.target.value)} />
                    </div>
                </div>

                {activeTransactions.length === 0 ? (
                    <p>No hay transacciones que mostrar. Importa un archivo para comenzar.</p>
                ) : (
                    <div className="table-container">
                        <table className="transactions-table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Descripción</th>
                                    <th>Importe</th>
                                    <th>Categoría</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeTransactions.map(t => (
                                    <TransactionRow key={t.id} transaction={t} onUpdate={onUpdateTransaction} allCategories={allCategories} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {ignoredTransactions.length > 0 && (
                    <details className="ignored-section">
                        <summary>Movimientos Ignorados ({ignoredTransactions.length})</summary>
                        <div className="table-container">
                            <table className="transactions-table">
                                <thead>
                                    <tr>
                                        <th>Fecha</th>
                                        <th>Descripción</th>
                                        <th>Importe</th>
                                        <th>Categoría</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ignoredTransactions.map(t => (
                                        <TransactionRow key={t.id} transaction={t} onUpdate={onUpdateTransaction} allCategories={allCategories} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </details>
                )}
            </div>
        </div>
    );
};

interface TransactionRowProps {
    transaction: Transaction;
    onUpdate: (id: string, newValues: Partial<Transaction>) => void;
    allCategories: string[];
}

const TransactionRow: React.FC<TransactionRowProps> = ({ transaction, onUpdate, allCategories }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedTransaction, setEditedTransaction] = useState(transaction);

    const handleSave = () => {
        onUpdate(transaction.id, editedTransaction);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditedTransaction(transaction);
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <tr className="editing">
                <td>
                    <input type="date" value={formatDateForInput(new Date(editedTransaction.date.split('/').reverse().join('-')))} onChange={e => setEditedTransaction(prev => ({ ...prev, date: new Date(e.target.value).toLocaleDateString('es-ES') }))} />
                </td>
                <td>
                    <input type="text" value={editedTransaction.description} onChange={e => setEditedTransaction(prev => ({ ...prev, description: e.target.value }))} />
                </td>
                <td>
                    <input type="number" value={editedTransaction.amount} onChange={e => setEditedTransaction(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))} />
                </td>
                <td>
                    <select value={editedTransaction.category} onChange={e => setEditedTransaction(prev => ({ ...prev, category: e.target.value }))}>
                        <option value="">Sin categoría</option>
                        {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                </td>
                <td>
                    <button className="button-icon success" onClick={handleSave}><SaveIcon /></button>
                    <button className="button-icon" onClick={handleCancel}><CancelIcon /></button>
                </td>
            </tr>
        );
    }

    return (
        <tr className={transaction.ignored ? 'ignored' : ''}>
            <td>{transaction.date}</td>
            <td>{transaction.description}</td>
            <td className={transaction.amount >= 0 ? 'positive' : 'negative'}>
                €{transaction.amount.toFixed(2)}
            </td>
            <td>
                <span className={transaction.category ? 'category-badge' : 'no-category'}>
                    {transaction.category || 'Sin categoría'}
                </span>
            </td>
            <td>
                <button className="button-icon" onClick={() => setIsEditing(true)}><EditIcon /></button>
                <button className="button-icon" onClick={() => onUpdate(transaction.id, { ignored: !transaction.ignored })}>
                    {transaction.ignored ? <RestoreIcon /> : <IgnoreIcon />}
                </button>
            </td>
        </tr>
    );
};

// --- Categories View Component ---
interface CategoriesViewProps {
    categories: Categories;
    onAddCategory: (type: CategoryType, name: string) => void;
    onDeleteCategory: (type: CategoryType, id: string) => void;
    onAddKeyword: (type: CategoryType, categoryId: string, keyword: string) => void;
    onRemoveKeyword: (type: CategoryType, categoryId: string, keyword: string) => void;
    editingCategory: string | null;
    setEditingCategory: (id: string | null) => void;
}

const CategoriesView: React.FC<CategoriesViewProps> = ({ categories, onAddCategory, onDeleteCategory, onAddKeyword, onRemoveKeyword, editingCategory, setEditingCategory }) => {
    const [newCategoryName, setNewCategoryName] = useState('');
    const [activeType, setActiveType] = useState<CategoryType>('income');

    const handleAddCategory = () => {
        if (newCategoryName.trim()) {
            onAddCategory(activeType, newCategoryName);
            setNewCategoryName('');
        }
    };

    return (
        <div className="categories-view">
            <div className="panel">
                <h2>Gestionar Categorías</h2>
                <p>Define categorías y palabras clave para organizar tus movimientos automáticamente.</p>

                <div className="category-type-tabs">
                    <button className={activeType === 'income' ? 'active' : ''} onClick={() => setActiveType('income')}>
                        Ingresos
                    </button>
                    <button className={activeType === 'expense' ? 'active' : ''} onClick={() => setActiveType('expense')}>
                        Gastos
                    </button>
                </div>

                <div className="add-category-form">
                    <input
                        type="text"
                        placeholder="Nombre de la categoría"
                        value={newCategoryName}
                        onChange={e => setNewCategoryName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                    />
                    <button className="button primary" onClick={handleAddCategory}>Añadir</button>
                </div>

                <div className="categories-list">
                    {categories[activeType].map(category => (
                        <CategoryCard
                            key={category.id}
                            category={category}
                            type={activeType}
                            onDelete={onDeleteCategory}
                            onAddKeyword={onAddKeyword}
                            onRemoveKeyword={onRemoveKeyword}
                            isEditing={editingCategory === category.id}
                            setIsEditing={setEditingCategory}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

interface CategoryCardProps {
    category: Category;
    type: CategoryType;
    onDelete: (type: CategoryType, id: string) => void;
    onAddKeyword: (type: CategoryType, categoryId: string, keyword: string) => void;
    onRemoveKeyword: (type: CategoryType, categoryId: string, keyword: string) => void;
    isEditing: boolean;
    setIsEditing: (id: string | null) => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ category, type, onDelete, onAddKeyword, onRemoveKeyword, isEditing, setIsEditing }) => {
    const [newKeyword, setNewKeyword] = useState('');

    const handleAddKeyword = () => {
        if (newKeyword.trim()) {
            onAddKeyword(type, category.id, newKeyword);
            setNewKeyword('');
        }
    };

    return (
        <div className="category-card">
            <div className="category-header">
                <h4>{category.name}</h4>
                <button className="button-icon danger" onClick={() => onDelete(type, category.id)}>
                    <DeleteIcon />
                </button>
            </div>
            <div className="keywords-section">
                <p className="keywords-label">Palabras clave:</p>
                <div className="keywords-list">
                    {category.keywords.map(keyword => (
                        <span key={keyword} className="keyword-badge">
                            {keyword}
                            <button onClick={() => onRemoveKeyword(type, category.id, keyword)}>×</button>
                        </span>
                    ))}
                </div>
                {isEditing ? (
                    <div className="add-keyword-form">
                        <input
                            type="text"
                            placeholder="Nueva palabra clave"
                            value={newKeyword}
                            onChange={e => setNewKeyword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddKeyword()}
                        />
                        <button className="button-icon success" onClick={handleAddKeyword}><AddIcon /></button>
                        <button className="button-icon" onClick={() => setIsEditing(null)}><CancelIcon /></button>
                    </div>
                ) : (
                    <button className="button-add-keyword" onClick={() => setIsEditing(category.id)}>
                        + Añadir palabra clave
                    </button>
                )}
            </div>
        </div>
    );
};

// --- How It Works View Component ---
const HowItWorksView: React.FC = () => {
    return (
        <div className="how-it-works-view">
            <div className="panel">
                <h2>Cómo funciona Nudistracker</h2>
                <div className="instructions-detailed">
                    <section>
                        <h3>1. Importa tus movimientos</h3>
                        <p>Descarga tu extracto bancario en formato CSV o Excel y súbelo a Nudistracker. La aplicación detectará automáticamente las columnas importantes.</p>
                    </section>
                    <section>
                        <h3>2. Crea categorías personalizadas</h3>
                        <p>Define categorías que representen tus fuentes de ingresos y tipos de gastos. Añade palabras clave para que la aplicación categorice automáticamente tus movimientos.</p>
                    </section>
                    <section>
                        <h3>3. Visualiza y analiza</h3>
                        <p>Revisa tu resumen financiero, filtra por categorías y períodos, y comprende a dónde va tu dinero.</p>
                    </section>
                    <section>
                        <h3>Consejos para mejores resultados</h3>
                        <ul>
                            <li>Usa palabras clave específicas en tus categorías para mejorar la precisión de la categorización automática.</li>
                            <li>Revisa regularmente las transacciones sin categoría y ajústalas manualmente.</li>
                            <li>Exporta tus datos periódicamente como respaldo.</li>
                        </ul>
                    </section>
                </div>
            </div>
        </div>
    );
};

// --- ICONS (SVG) ---
const UploadIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>
);

const EditIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
);

const DeleteIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
);

const SaveIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
);

const CancelIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
);

const IgnoreIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
    </svg>
);

const RestoreIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1 4 1 10 7 10"></polyline>
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
    </svg>
);

const AddIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
);

export default App;