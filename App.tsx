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
    const cleanedStr = String(numStr || '0').replace(/[^\d.,-]/g, '').trim();
    let parsableStr = cleanedStr;

    if (format === 'eur') {
        // Format: 1.234,56 -> 1234.56
        parsableStr = cleanedStr.replace(/\./g, '').replace(',', '.');
    } else { // 'usa'
        // Format: 1,234.56 -> 1234.56
        parsableStr = cleanedStr.replace(/,/g, '');
    }
    
    return parseFloat(parsableStr) || 0;
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
                                <input type="radio" name="number-format" value="usa" checked={numberFormat === '