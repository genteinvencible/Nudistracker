import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import ShareModal from './ShareModal';

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
const formatCurrency = (amount: number, format: NumberFormat): string => {
    const absAmount = Math.abs(amount);
    if (format === 'eur') {
        return absAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
        return absAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
};

const normalizeString = (str: string): string => {
    if (!str) return '';
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
};

const parseDate = (dateValue: any): string => {
    if (!dateValue) return 'Invalid Date';

    // Handle string dates first (most common)
    if (typeof dateValue === 'string') {
        const trimmed = dateValue.trim();

        // Check if it's already in DD/MM/YYYY or similar format
        if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(trimmed)) {
            const parts = trimmed.split(/[\/\-]/);
            // Assume European format DD/MM/YYYY
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const year = parts[2].length === 2 ? 2000 + parseInt(parts[2], 10) : parseInt(parts[2], 10);

            if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                const date = new Date(year, month - 1, day);
                if (!isNaN(date.getTime())) {
                    return date.toLocaleDateString('es-ES');
                }
            }
        }

        // Check if it's in YYYY-MM-DD format (ISO)
        if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(trimmed)) {
            const date = new Date(trimmed);
            if (!isNaN(date.getTime())) {
                return date.toLocaleDateString('es-ES');
            }
        }

        // Try standard Date parsing as fallback
        const date = new Date(trimmed);
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('es-ES');
        }
    }

    // Handle Excel's numeric date format (only if it's a reasonable Excel date)
    // Excel dates typically range from 1 (1900-01-01) to ~45000 (year 2023+)
    if (typeof dateValue === 'number' && dateValue > 0 && dateValue < 100000) {
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
        // Basic timezone offset correction
        const userTimezoneOffset = date.getTimezoneOffset() * 60000;
        const correctedDate = new Date(date.getTime() + userTimezoneOffset);
        if (!isNaN(correctedDate.getTime())) {
            return correctedDate.toLocaleDateString('es-ES');
        }
    }

    // Fallback for Date objects
    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        return dateValue.toLocaleDateString('es-ES');
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
            try {
                const dataToSave = JSON.stringify({ transactions, categories, numberFormat });
                localStorage.setItem('finanzasNudistaSession', dataToSave);
            } catch (error) {
                console.error('Error guardando sesión:', error);
            }
        }
    }, [transactions, categories, numberFormat, appState]);

    // Reset import state when navigating away from import view or after finalizing
    useEffect(() => {
        if (tracker_view !== 'import') {
            setFileHeaders([]);
            setParsedData([]);
            setFilePreview([]);
        }
    }, [tracker_view]);

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
            const { transactions, categories, numberFormat: savedFormat } = JSON.parse(savedData);
            // FIX: Ensure all transactions have an 'ignored' property and that 'amount' is a number for backwards compatibility.
            // This prevents type errors in calculations when data is loaded from localStorage.
            const hydratedTransactions = (transactions || []).map((t: any) => ({ ...t, amount: Number(t.amount) || 0, ignored: t.ignored || false }));
            setTransactions(hydratedTransactions);
            setCategories(categories || { income: [], expense: [] });
            setNumberFormat(savedFormat || 'eur');
        }
        setAppState('tracker');
        setTrackerView('transactions');
    };

    const handleClearSession = () => {
        localStorage.removeItem('finanzasNudistaSession');
        setAppState('welcome'); // Force re-render of welcome screen
    };

    const handleGoToWelcome = () => {
        const confirmLeave = window.confirm('¿Estás seguro de que quieres volver a la pantalla de inicio? Asegúrate de que tus datos estén guardados.');
        if (confirmLeave) {
            setAppState('welcome');
            setStagedTransactions([]);
            setFileHeaders([]);
            setParsedData([]);
            setFilePreview([]);
            setMappedColumns({ date: '', description: '', amount: '' });
        }
    };
    
    // --- HANDLERS: FILE IMPORT ---
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
            return;
        }

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array', codepage: 65001, cellDates: true });
            const sheetName = workbook.SheetNames[0];

            if (!sheetName) {
                throw new Error('El archivo no contiene ninguna hoja de datos');
            }

            const worksheet = workbook.Sheets[sheetName];
            const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });

            if (!jsonData || jsonData.length === 0) {
                throw new Error('El archivo está vacío');
            }

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

            const dataRows = jsonData.slice(headerRowIndex + 1).filter(row =>
                row && row.length > 0 && row.some(cell => cell !== null && cell !== undefined && cell !== '')
            );

            if (dataRows.length === 0) {
                throw new Error('No se encontraron datos en el archivo');
            }

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
            console.error('Error al procesar archivo:', error);
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
            alert(`Hubo un error al procesar el archivo: ${errorMessage}\n\nAsegúrate de que es un archivo CSV o Excel válido con datos.`);

            setFileHeaders([]);
            setParsedData([]);
            setFilePreview([]);
            setMappedColumns({ date: '', description: '', amount: '' });
        } finally {
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };
    
    const handleProcessMappedFile = () => {
        if (!mappedColumns.date || !mappedColumns.description || !mappedColumns.amount) {
            alert('Por favor, mapea todas las columnas requeridas (fecha, descripción e importe)');
            return;
        }

        if (parsedData.length === 0) {
            alert('No hay datos para procesar');
            return;
        }

        try {
            const newTransactions = parsedData.map((row, index) => {
                const dateIndex = fileHeaders.indexOf(mappedColumns.date);
                const descIndex = fileHeaders.indexOf(mappedColumns.description);
                const amountIndex = fileHeaders.indexOf(mappedColumns.amount);

                if (dateIndex === -1 || descIndex === -1 || amountIndex === -1) {
                    throw new Error('Columnas mapeadas no encontradas en el archivo');
                }

                const date = parseDate(row[dateIndex]);
                const description = String(row[descIndex] || '');
                const rawAmount = String(row[amountIndex] || '0');
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

            if (newTransactions.length === 0) {
                alert('No se encontraron transacciones válidas en el archivo');
                return;
            }

            const autoCategorized = newTransactions.map(t => {
                const foundCategory = autoCategorizeTransaction(t.description, categories);
                return { ...t, category: foundCategory || '' };
            });

            setStagedTransactions(prev => [...prev, ...autoCategorized]);
            setParsedData([]);
            setFileHeaders([]);
            setFilePreview([]);
        } catch (error) {
            console.error('Error al procesar transacciones:', error);
            alert('Hubo un error al procesar las transacciones. Por favor, verifica el mapeo de columnas.');
        }
    };
    
    const handleFinalizeStaging = () => {
        if (stagedTransactions.length === 0) {
            alert('No hay transacciones para finalizar');
            return;
        }
        setTransactions(prev => [...prev, ...stagedTransactions]);
        setStagedTransactions([]);
        setFileHeaders([]);
        setParsedData([]);
        setFilePreview([]);
        setMappedColumns({ date: '', description: '', amount: '' });
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

    const renameCategory = (type: CategoryType, id: string, newName: string) => {
        if (!newName.trim()) return;
        setCategories(prev => ({ ...prev, [type]: prev[type].map(c => c.id === id ? { ...c, name: newName.trim() } : c) }));
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
                        numberFormat={numberFormat}
                    />
                }
                {tracker_view === 'categories' &&
                    <CategoriesView
                        categories={categories}
                        onAddCategory={addCategory}
                        onDeleteCategory={deleteCategory}
                        onRenameCategory={renameCategory}
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
                    <h2>This is Nudistracker:</h2>
                    <p>La forma más sencilla de entender tus finanzas.</p>
                    <div className="instructions">
                        <h4>La F de f*ck you money empieza aquí:</h4>
                        <ol className="instructions-list">
                            <li>Exporta tus movimientos bancarios a un archivo CSV o Excel.</li>
                            <li>Haz clic en "Nueva Sesión" e importa tu archivo.</li>
                            <li>Visualiza, categoriza y entiende a dónde va tu dinero.</li>
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
                        <h4>⚠️ Formato de los números en tu archivo</h4>
                        <p className="format-help">Selecciona cómo aparecen los importes en tu archivo CSV/Excel:</p>
                        <div className="radio-group">
                            <label className={numberFormat === 'eur' ? 'selected' : ''}>
                                <input type="radio" name="number-format" value="eur" checked={numberFormat === 'eur'} onChange={() => setNumberFormat('eur')} />
                                <span className="format-option">
                                    <strong>Formato Europeo:</strong> 1.234,56<br/>
                                    <small>(Punto para miles, coma para decimales)</small>
                                </span>
                            </label>
                            <label className={numberFormat === 'usa' ? 'selected' : ''}>
                                <input type="radio" name="number-format" value="usa" checked={numberFormat === 'usa'} onChange={() => setNumberFormat('usa')} />
                                <span className="format-option">
                                    <strong>Formato Americano:</strong> 1,234.56<br/>
                                    <small>(Coma para miles, punto para decimales)</small>
                                </span>
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
                                                {row.map((cell, j) => {
                                                    const header = fileHeaders[j];
                                                    const isDateColumn = mappedColumns.date && header === mappedColumns.date;
                                                    const isAmountColumn = mappedColumns.amount && header === mappedColumns.amount;

                                                    if (isDateColumn) {
                                                        const rawValue = String(cell || '');
                                                        const parsedDate = parseDate(cell);
                                                        return (
                                                            <td key={j} title={`Original: ${rawValue} → Interpretado: ${parsedDate}`}>
                                                                {rawValue} → {parsedDate}
                                                            </td>
                                                        );
                                                    }

                                                    if (isAmountColumn) {
                                                        const rawValue = String(cell || '');
                                                        const parsedValue = parseAmount(rawValue, numberFormat);
                                                        const formattedValue = numberFormat === 'eur'
                                                            ? parsedValue.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigals: 2 })
                                                            : parsedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                                        return (
                                                            <td key={j} title={`Original: ${rawValue} → Interpretado: ${parsedValue}`}>
                                                                {rawValue} → {formattedValue}
                                                            </td>
                                                        );
                                                    }

                                                    return <td key={j}>{String(cell || '')}</td>;
                                                })}
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
                    <div className="staged-header">
                        <h3>Transacciones Importadas</h3>
                    </div>
                    <p className="staged-hint">Revisa y ajusta las transacciones antes de añadirlas a tu registro</p>
                    <div className="staged-quick-actions">
                        <button className="button primary" onClick={onFinalize}>
                            Añadir {stagedTransactions.length} transacciones sin revisar
                        </button>
                    </div>
                    <div className="staged-table-container">
                        <table className="staged-table">
                            <thead>
                                <tr>
                                    <th className="date-col">Fecha</th>
                                    <th className="description-col">Descripción</th>
                                    <th className="amount-col">Importe</th>
                                    <th className="category-col">Categoría</th>
                                    <th className="actions-col">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stagedTransactions.map(t => (
                                    <tr key={t.id}>
                                        <td className="date-col">
                                            <span className="date-badge">{t.date}</span>
                                        </td>
                                        <td className="description-col">
                                            <input
                                                type="text"
                                                className="staged-input"
                                                value={t.description}
                                                onChange={e => onUpdateStaged(t.id, { description: e.target.value })}
                                                placeholder="Descripción"
                                            />
                                        </td>
                                        <td className="amount-col">
                                            <div className="amount-wrapper">
                                                <input
                                                    type="number"
                                                    className={`staged-input amount-input ${t.amount >= 0 ? 'positive' : 'negative'}`}
                                                    value={t.amount}
                                                    onChange={e => onUpdateStaged(t.id, { amount: parseFloat(e.target.value) || 0 })}
                                                    step="0.01"
                                                />
                                                <span className="currency-symbol">€</span>
                                            </div>
                                        </td>
                                        <td className="category-col">
                                            <select
                                                className="staged-select"
                                                value={t.category}
                                                onChange={e => onUpdateStaged(t.id, { category: e.target.value })}
                                            >
                                                <option value="">Sin categoría</option>
                                                {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                            </select>
                                        </td>
                                        <td className="actions-col">
                                            <button className="button-icon danger" onClick={() => onDeleteStaged(t.id)} title="Eliminar transacción">
                                                <DeleteIcon />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="staged-footer">
                        <button className="button primary" onClick={onFinalize}>
                            Añadir {stagedTransactions.length} transacciones
                        </button>
                    </div>
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
    numberFormat: NumberFormat;
}

const TransactionsView: React.FC<TransactionsViewProps> = ({ transactions, onUpdateTransaction, onAddTransaction, onAutoCategorize, allCategories, categoryFilter, setCategoryFilter, startDateFilter, setStartDateFilter, endDateFilter, setEndDateFilter, numberFormat }) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
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

    const totalIncome = transactions.filter(t => !t.ignored && t.amount > 0).reduce((acc, t) => acc + t.amount, 0);
    const totalExpense = transactions.filter(t => !t.ignored && t.amount < 0).reduce((acc, t) => acc + Math.abs(t.amount), 0);
    const balance = totalIncome - totalExpense;

    const categoryBreakdown = transactions
        .filter(t => !t.ignored && t.amount < 0 && t.category)
        .reduce((acc, t) => {
            const cat = t.category;
            acc[cat] = (acc[cat] || 0) + Math.abs(t.amount);
            return acc;
        }, {} as Record<string, number>);

    const categoryData = Object.entries(categoryBreakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    const maxCategoryAmount = categoryData.length > 0 ? Math.max(...categoryData.map(([, amount]) => amount)) : 0;

    return (
        <div className="transactions-view">
            <div className="panel summary-panel">
                <div className="summary-panel-header">
                    <h2>Resumen Financiero</h2>
                    <button className="button secondary share-button" onClick={() => setShowShareModal(true)}>
                        📤 Compartir Resumen
                    </button>
                </div>
                <div className="summary-cards">
                    <div className="summary-card income">
                        <div className="summary-icon">📈</div>
                        <div className="summary-content">
                            <span className="summary-label">Ingresos</span>
                            <span className="summary-value">€{formatCurrency(totalIncome, numberFormat)}</span>
                        </div>
                    </div>
                    <div className="summary-card expense">
                        <div className="summary-icon">📉</div>
                        <div className="summary-content">
                            <span className="summary-label">Gastos</span>
                            <span className="summary-value">€{formatCurrency(totalExpense, numberFormat)}</span>
                        </div>
                    </div>
                    <div className={`summary-card balance ${balance >= 0 ? 'positive' : 'negative'}`}>
                        <div className="summary-icon">{balance >= 0 ? '💰' : '⚠️'}</div>
                        <div className="summary-content">
                            <span className="summary-label">Balance</span>
                            <span className="summary-value">€{formatCurrency(balance, numberFormat)}</span>
                        </div>
                    </div>
                </div>

                {categoryData.length > 0 && (
                    <div className="category-chart">
                        <h3>Gastos por Categoría</h3>
                        <div className="chart-bars">
                            {categoryData.map(([category, amount]) => {
                                const percentage = (amount / maxCategoryAmount) * 100;
                                return (
                                    <div key={category} className="chart-bar-item">
                                        <div className="chart-bar-label">
                                            <span className="chart-category-name">{category}</span>
                                            <span className="chart-category-amount">€{formatCurrency(amount, numberFormat)}</span>
                                        </div>
                                        <div className="chart-bar-container">
                                            <div
                                                className="chart-bar-fill"
                                                style={{ width: `${percentage}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {showShareModal && (
                <ShareModal
                    totalIncome={totalIncome}
                    totalExpense={totalExpense}
                    balance={balance}
                    categoryData={categoryData}
                    maxCategoryAmount={maxCategoryAmount}
                    formatCurrency={(amount) => formatCurrency(amount, numberFormat)}
                    startDateFilter={startDateFilter}
                    endDateFilter={endDateFilter}
                    onClose={() => setShowShareModal(false)}
                />
            )}

            <div className="panel transactions-panel">
                <h2 className="movements-title">Todos los Movimientos</h2>

                {showAddForm && (
                    <div className="add-form">
                        <h4>Nueva Transacción</h4>
                        <div className="form-grid">
                            <div className="form-field">
                                <label>Fecha</label>
                                <input
                                    type="date"
                                    value={newTransactionData.date}
                                    onChange={e => setNewTransactionData(prev => ({ ...prev, date: e.target.value }))}
                                />
                            </div>
                            <div className="form-field full-width">
                                <label>Descripción</label>
                                <input
                                    type="text"
                                    placeholder="Ej: Compra en supermercado"
                                    value={newTransactionData.description}
                                    onChange={e => setNewTransactionData(prev => ({ ...prev, description: e.target.value }))}
                                />
                            </div>
                            <div className="form-field">
                                <label>Importe (€)</label>
                                <input
                                    type="number"
                                    placeholder="0.00"
                                    value={newTransactionData.amount}
                                    onChange={e => setNewTransactionData(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                                    step="0.01"
                                />
                            </div>
                            <div className="form-field">
                                <label>Categoría</label>
                                <select
                                    value={newTransactionData.category}
                                    onChange={e => setNewTransactionData(prev => ({ ...prev, category: e.target.value }))}
                                >
                                    <option value="">Sin categoría</option>
                                    {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="form-actions">
                            <button className="button primary" onClick={handleAdd}>Añadir</button>
                            <button className="button" onClick={() => setShowAddForm(false)}>Cancelar</button>
                        </div>
                    </div>
                )}

                <div className="movements-filters">
                    <div className="date-filters-row">
                        <div className="date-filter-group">
                            <label>Rango de Fechas</label>
                            <div className="date-inputs">
                                <input type="date" className="date-input-clean" value={startDateFilter} onChange={e => setStartDateFilter(e.target.value)} placeholder="dd/mm/aaaa" />
                                <input type="date" className="date-input-clean" value={endDateFilter} onChange={e => setEndDateFilter(e.target.value)} placeholder="dd/mm/aaaa" />
                            </div>
                        </div>
                        <div className="category-filter-group">
                            <label>Categoría</label>
                            <select className="category-select-clean" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                                <option value="all">Todas</option>
                                <option value="uncategorized">Sin categorizar</option>
                                {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="quick-filters">
                        <button className="quick-filter-btn" onClick={() => {
                            const now = new Date();
                            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                            setStartDateFilter(firstDay.toISOString().split('T')[0]);
                            setEndDateFilter(new Date().toISOString().split('T')[0]);
                        }}>Este Mes</button>
                        <button className="quick-filter-btn" onClick={() => {
                            const now = new Date();
                            const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                            const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
                            setStartDateFilter(firstDay.toISOString().split('T')[0]);
                            setEndDateFilter(lastDay.toISOString().split('T')[0]);
                        }}>Mes Pasado</button>
                        <button className="quick-filter-btn" onClick={() => {
                            const now = new Date();
                            const firstDay = new Date(now.getFullYear(), 0, 1);
                            setStartDateFilter(firstDay.toISOString().split('T')[0]);
                            setEndDateFilter(new Date().toISOString().split('T')[0]);
                        }}>Este Año</button>
                        <button className="quick-filter-btn" onClick={() => {
                            setStartDateFilter('');
                            setEndDateFilter('');
                        }}>Todo</button>
                    </div>
                    <div className="action-buttons-row">
                        <button className="action-btn outline" onClick={onAutoCategorize}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                <polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline>
                                <polyline points="7.5 19.79 7.5 14.6 3 12"></polyline>
                                <polyline points="21 12 16.5 14.6 16.5 19.79"></polyline>
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                <line x1="12" y1="22.08" x2="12" y2="12"></line>
                            </svg>
                            Auto-categorizar
                        </button>
                        <button className="action-btn outline" onClick={() => setShowShareModal(true)}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                                <polyline points="16 6 12 2 8 6"></polyline>
                                <line x1="12" y1="2" x2="12" y2="15"></line>
                            </svg>
                            Exportar Resumen
                        </button>
                        <button className="action-btn primary" onClick={() => setShowAddForm(true)}>
                            + Añadir Movimiento
                        </button>
                    </div>
                    {(categoryFilter !== 'all' || startDateFilter || endDateFilter) && (
                        <button className="clear-filters-btn" onClick={() => {
                            setCategoryFilter('all');
                            setStartDateFilter('');
                            setEndDateFilter('');
                        }}>Limpiar filtros</button>
                    )}
                </div>

                {transactions.length === 0 ? (
                    <div className="empty-state">
                        <p>No hay transacciones que mostrar.</p>
                        <p className="empty-hint">Importa un archivo para comenzar.</p>
                    </div>
                ) : (
                    <div className="transactions-table-container">
                        <table className="transactions-table">
                            <thead>
                                <tr>
                                    <th className="th-date">Fecha</th>
                                    <th className="th-description">Descripción</th>
                                    <th className="th-amount">Importe</th>
                                    <th className="th-category">Categoría</th>
                                    <th className="th-actions">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map(t => (
                                    <TransactionRow key={t.id} transaction={t} onUpdate={onUpdateTransaction} allCategories={allCategories} />
                                ))}
                            </tbody>
                        </table>
                    </div>
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
    const handleDateChange = (value: string) => {
        const date = new Date(value);
        const formattedDate = date.toLocaleDateString('es-ES');
        onUpdate(transaction.id, { date: formattedDate });
    };

    const dateValue = transaction.date.split('/').reverse().join('-');

    return (
        <tr className={transaction.ignored ? 'ignored' : ''}>
            <td className="td-date">
                <input
                    type="date"
                    className="inline-edit-input date-input"
                    value={dateValue}
                    onChange={e => handleDateChange(e.target.value)}
                />
            </td>
            <td className="td-description">
                <input
                    type="text"
                    className="inline-edit-input"
                    value={transaction.description}
                    onChange={e => onUpdate(transaction.id, { description: e.target.value })}
                    placeholder="Descripción"
                />
            </td>
            <td className="td-amount">
                <input
                    type="number"
                    className={`inline-edit-input amount-input ${transaction.amount >= 0 ? 'positive' : 'negative'}`}
                    value={transaction.amount}
                    onChange={e => onUpdate(transaction.id, { amount: parseFloat(e.target.value) || 0 })}
                    step="0.01"
                />
            </td>
            <td className="td-category">
                <select
                    className="inline-edit-select"
                    value={transaction.category}
                    onChange={e => onUpdate(transaction.id, { category: e.target.value })}
                >
                    <option value="">Sin categoría</option>
                    {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
            </td>
            <td className="td-actions">
                <button
                    className="button-icon"
                    onClick={() => onUpdate(transaction.id, { ignored: !transaction.ignored })}
                    title={transaction.ignored ? 'Restaurar' : 'Ignorar'}
                >
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
    onRenameCategory: (type: CategoryType, id: string, newName: string) => void;
    onAddKeyword: (type: CategoryType, categoryId: string, keyword: string) => void;
    onRemoveKeyword: (type: CategoryType, categoryId: string, keyword: string) => void;
    editingCategory: string | null;
    setEditingCategory: (id: string | null) => void;
}

const CategoriesView: React.FC<CategoriesViewProps> = ({ categories, onAddCategory, onDeleteCategory, onRenameCategory, onAddKeyword, onRemoveKeyword, editingCategory, setEditingCategory }) => {
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
            <div className="panel categories-panel">
                <h2>Gestionar Categorías</h2>
                <p>Crea categorías para tus ingresos y gastos. Añade palabras clave para automatizar la clasificación al importar nuevos archivos.</p>

                <div className="categories-grid">
                    <div className="category-column">
                        <h3>Categorías de Ingresos</h3>
                        <div className="add-category-form">
                            <input
                                type="text"
                                placeholder="Añadir nueva categoría de ingreso..."
                                value={activeType === 'income' ? newCategoryName : ''}
                                onChange={e => {
                                    setActiveType('income');
                                    setNewCategoryName(e.target.value);
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && activeType === 'income') {
                                        handleAddCategory();
                                    }
                                }}
                            />
                            <button
                                onClick={() => {
                                    setActiveType('income');
                                    handleAddCategory();
                                }}
                            >
                                +
                            </button>
                        </div>
                        {categories.income.length === 0 ? (
                            <div className="empty-state">
                                <p>No hay categorías. ¡Añade una para empezar!</p>
                            </div>
                        ) : (
                            <div className="category-list">
                                {categories.income.map(category => (
                                    <CategoryCard
                                        key={category.id}
                                        category={category}
                                        type="income"
                                        onDelete={onDeleteCategory}
                                        onRename={onRenameCategory}
                                        onAddKeyword={onAddKeyword}
                                        onRemoveKeyword={onRemoveKeyword}
                                        isEditing={editingCategory === category.id}
                                        setIsEditing={setEditingCategory}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="category-column">
                        <h3>Categorías de Gastos</h3>
                        <div className="add-category-form">
                            <input
                                type="text"
                                placeholder="Añadir nueva categoría de gasto..."
                                value={activeType === 'expense' ? newCategoryName : ''}
                                onChange={e => {
                                    setActiveType('expense');
                                    setNewCategoryName(e.target.value);
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && activeType === 'expense') {
                                        handleAddCategory();
                                    }
                                }}
                            />
                            <button
                                onClick={() => {
                                    setActiveType('expense');
                                    handleAddCategory();
                                }}
                            >
                                +
                            </button>
                        </div>
                        {categories.expense.length === 0 ? (
                            <div className="empty-state">
                                <p>No hay categorías. ¡Añade una para empezar!</p>
                            </div>
                        ) : (
                            <div className="category-list">
                                {categories.expense.map(category => (
                                    <CategoryCard
                                        key={category.id}
                                        category={category}
                                        type="expense"
                                        onDelete={onDeleteCategory}
                                        onRename={onRenameCategory}
                                        onAddKeyword={onAddKeyword}
                                        onRemoveKeyword={onRemoveKeyword}
                                        isEditing={editingCategory === category.id}
                                        setIsEditing={setEditingCategory}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface CategoryCardProps {
    category: Category;
    type: CategoryType;
    onDelete: (type: CategoryType, id: string) => void;
    onRename: (type: CategoryType, id: string, newName: string) => void;
    onAddKeyword: (type: CategoryType, categoryId: string, keyword: string) => void;
    onRemoveKeyword: (type: CategoryType, categoryId: string, keyword: string) => void;
    isEditing: boolean;
    setIsEditing: (id: string | null) => void;
}

const CategoryCard: React.FC<CategoryCardProps> = ({ category, type, onDelete, onRename, onAddKeyword, onRemoveKeyword, isEditing, setIsEditing }) => {
    const [newKeyword, setNewKeyword] = useState('');
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(category.name);

    const handleAddKeyword = () => {
        if (newKeyword.trim()) {
            onAddKeyword(type, category.id, newKeyword);
            setNewKeyword('');
        }
    };

    const handleSaveName = () => {
        if (editedName.trim() && editedName !== category.name) {
            onRename(type, category.id, editedName);
        }
        setIsEditingName(false);
    };

    const handleCancelEdit = () => {
        setEditedName(category.name);
        setIsEditingName(false);
    };

    return (
        <div className="category-card">
            <div className="category-card-header">
                {isEditingName ? (
                    <div className="category-name-edit">
                        <input
                            type="text"
                            className="category-name-input"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveName();
                                } else if (e.key === 'Escape') {
                                    handleCancelEdit();
                                }
                            }}
                            autoFocus
                        />
                        <button
                            className="button-icon success"
                            onClick={handleSaveName}
                            title="Guardar"
                        >
                            <AddIcon />
                        </button>
                        <button
                            className="button-icon"
                            onClick={handleCancelEdit}
                            title="Cancelar"
                        >
                            <CancelIcon />
                        </button>
                    </div>
                ) : (
                    <>
                        <h4 className="category-name" onClick={() => setIsEditingName(true)} style={{ cursor: 'pointer' }} title="Haz clic para editar">
                            {category.name}
                        </h4>
                        <button
                            className="button-icon danger"
                            onClick={() => onDelete(type, category.id)}
                            title="Eliminar categoría"
                        >
                            <DeleteIcon />
                        </button>
                    </>
                )}
            </div>
            <div className="keywords-section">
                <div className="keywords-header">
                    <span className="keywords-label">Palabras clave</span>
                    <span className="keywords-count">{category.keywords.length}</span>
                </div>
                {category.keywords.length > 0 && (
                    <div className="keywords-list">
                        {category.keywords.map(keyword => (
                            <span key={keyword} className="keyword-badge">
                                {keyword}
                                <button
                                    className="keyword-remove"
                                    onClick={() => onRemoveKeyword(type, category.id, keyword)}
                                    title="Eliminar palabra clave"
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                <div className="add-keyword-form">
                    <input
                        type="text"
                        className="keyword-input"
                        placeholder="Escribe una palabra clave y pulsa Enter"
                        value={newKeyword}
                        onChange={e => setNewKeyword(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddKeyword();
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

// --- How It Works View Component ---
const HowItWorksView: React.FC = () => {
    return (
        <div className="how-it-works-view">
            <div className="steps-grid-modern">
                <div className="step-card-modern">
                    <div className="step-icon-circle">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4M17 9l-5 5-5-5M12 12.8V2.5"/>
                        </svg>
                    </div>
                    <h3>1. Exporta tus Movimientos</h3>
                    <p>Entra en la web de tu banco y descarga un archivo (CSV o Excel) con tus últimos movimientos.</p>
                </div>

                <div className="step-card-modern">
                    <div className="step-icon-circle">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                    </div>
                    <h3>2. Importa el Archivo</h3>
                    <p>Vuelve aquí, ve a la pestaña "Importar" y sube el archivo que has descargado. Mapea las columnas de fecha, descripción e importe.</p>
                </div>

                <div className="step-card-modern">
                    <div className="step-icon-circle">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                            <line x1="7" y1="7" x2="7.01" y2="7"></line>
                        </svg>
                    </div>
                    <h3>3. Crea y Asigna Categorías</h3>
                    <p>Ve a "Categorías" para crear tus propias clasificaciones (ej: "Supermercado"). Añade palabras clave (ej: "Mercadona") para que la app categorice tus movimientos automáticamente.</p>
                </div>

                <div className="step-card-modern">
                    <div className="step-icon-circle">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                            <line x1="12" y1="22.08" x2="12" y2="12"></line>
                        </svg>
                    </div>
                    <h3>4. Analiza tus Finanzas</h3>
                    <p>En "Movimientos", visualiza el resumen de tus ingresos y gastos y el desglose por categoría para entender a dónde va tu dinero.</p>
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
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