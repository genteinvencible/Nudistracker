import React, { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface ShareModalProps {
    totalIncome: number;
    totalExpense: number;
    balance: number;
    categoryData: [string, number][];
    maxCategoryAmount: number;
    formatCurrency: (amount: number) => string;
    startDateFilter: string;
    endDateFilter: string;
    onClose: () => void;
}

const ShareModal: React.FC<ShareModalProps> = ({
    totalIncome,
    totalExpense,
    balance,
    categoryData,
    maxCategoryAmount,
    formatCurrency,
    startDateFilter,
    endDateFilter,
    onClose
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

    React.useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const getDateRangeText = () => {
        if (startDateFilter && endDateFilter) {
            return `${startDateFilter} - ${endDateFilter}`;
        } else if (startDateFilter) {
            return `Desde ${startDateFilter}`;
        } else if (endDateFilter) {
            return `Hasta ${endDateFilter}`;
        }
        return 'Todo el período';
    };

    const handleDownloadImage = async () => {
        if (!contentRef.current) return;

        setIsGenerating(true);
        try {
            const canvas = await html2canvas(contentRef.current, {
                backgroundColor: '#ffffff',
                scale: 2,
                logging: false,
                useCORS: true,
                allowTaint: true,
                windowWidth: 1200,
                windowHeight: contentRef.current.scrollHeight,
            });

            const link = document.createElement('a');
            link.download = `resumen-financiero-${new Date().toISOString().split('T')[0]}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (error) {
            console.error('Error generating image:', error);
            alert('Error al generar la imagen');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopyToClipboard = async () => {
        if (!contentRef.current) return;

        setIsGenerating(true);
        try {
            const canvas = await html2canvas(contentRef.current, {
                backgroundColor: '#ffffff',
                scale: 2,
                logging: false,
                useCORS: true,
                allowTaint: true,
                windowWidth: 1200,
                windowHeight: contentRef.current.scrollHeight,
            });

            canvas.toBlob(async (blob) => {
                if (blob) {
                    try {
                        await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': blob })
                        ]);
                        alert('Imagen copiada al portapapeles');
                    } catch (err) {
                        console.error('Error copying to clipboard:', err);
                        alert('Tu navegador no soporta copiar imágenes. Usa la opción de descargar.');
                    }
                }
                setIsGenerating(false);
            });
        } catch (error) {
            console.error('Error generating image:', error);
            alert('Error al generar la imagen');
            setIsGenerating(false);
        }
    };

    const handleDownloadPDF = async () => {
        if (!contentRef.current) return;

        setIsGenerating(true);
        try {
            const canvas = await html2canvas(contentRef.current, {
                backgroundColor: '#ffffff',
                scale: 2,
                logging: false,
                useCORS: true,
                allowTaint: true,
                windowWidth: 1200,
                windowHeight: contentRef.current.scrollHeight,
            });

            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const imgWidth = 190;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
            pdf.save(`resumen-financiero-${new Date().toISOString().split('T')[0]}.pdf`);
        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('Error al generar el PDF');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content share-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Compartir Resumen Financiero</h2>
                    <button className="button-close" onClick={onClose}>×</button>
                </div>

                <div className="share-preview" ref={contentRef} style={{
                    background: 'linear-gradient(135deg, #ffffff 0%, #f9fafb 100%)',
                    padding: isMobile ? '24px' : '48px',
                    width: isMobile ? '100%' : '800px',
                    maxWidth: '100%',
                    boxSizing: 'border-box'
                }}>
                    <div className="share-header" style={{ borderBottom: '3px solid #d4af37', textAlign: 'center', marginBottom: isMobile ? '20px' : '32px', paddingBottom: isMobile ? '16px' : '24px' }}>
                        <h1 className="share-title" style={{ fontSize: isMobile ? '1.75rem' : '2.5rem', fontWeight: 800, color: '#1f2937', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>Resumen Financiero</h1>
                        <p className="share-period" style={{ fontSize: isMobile ? '0.875rem' : '1rem', color: '#6b7280', fontWeight: 600, margin: 0 }}>{getDateRangeText()}</p>
                    </div>

                    <div className="share-summary-cards" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: isMobile ? '16px' : '20px', marginBottom: isMobile ? '24px' : '40px' }}>
                        <div className="share-card income" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', borderRadius: '12px', padding: isMobile ? '20px' : '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', border: '2px solid #86efac', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)' }}>
                            <div className="share-card-icon" style={{ fontSize: isMobile ? '2.5rem' : '3rem', lineHeight: 1 }}>📈</div>
                            <div className="share-card-content" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                                <span className="share-card-label" style={{ fontSize: '0.875rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingresos</span>
                                <span className="share-card-value" style={{ fontSize: isMobile ? '1.5rem' : '1.75rem', fontWeight: 800, color: '#1f2937', lineHeight: 1 }}>€{formatCurrency(totalIncome)}</span>
                            </div>
                        </div>
                        <div className="share-card expense" style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', borderRadius: '12px', padding: isMobile ? '20px' : '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', border: '2px solid #fca5a5', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)' }}>
                            <div className="share-card-icon" style={{ fontSize: isMobile ? '2.5rem' : '3rem', lineHeight: 1 }}>📉</div>
                            <div className="share-card-content" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                                <span className="share-card-label" style={{ fontSize: '0.875rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gastos</span>
                                <span className="share-card-value" style={{ fontSize: isMobile ? '1.5rem' : '1.75rem', fontWeight: 800, color: '#1f2937', lineHeight: 1 }}>€{formatCurrency(totalExpense)}</span>
                            </div>
                        </div>
                        <div className={`share-card balance ${balance >= 0 ? 'positive' : 'negative'}`} style={{ background: balance >= 0 ? 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)' : 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', borderRadius: '12px', padding: isMobile ? '20px' : '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', border: balance >= 0 ? '2px solid #86efac' : '2px solid #fca5a5', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)' }}>
                            <div className="share-card-icon" style={{ fontSize: isMobile ? '2.5rem' : '3rem', lineHeight: 1 }}>{balance >= 0 ? '💰' : '⚠️'}</div>
                            <div className="share-card-content" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                                <span className="share-card-label" style={{ fontSize: '0.875rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</span>
                                <span className="share-card-value" style={{ fontSize: isMobile ? '1.5rem' : '1.75rem', fontWeight: 800, color: '#1f2937', lineHeight: 1 }}>€{formatCurrency(balance)}</span>
                            </div>
                        </div>
                    </div>

                    {categoryData.length > 0 && (
                        <div className="share-chart" style={{ marginTop: isMobile ? '24px' : '40px' }}>
                            <h3 className="share-chart-title" style={{ fontSize: isMobile ? '1.25rem' : '1.75rem', fontWeight: 700, color: '#1f2937', margin: isMobile ? '0 0 16px 0' : '0 0 24px 0', textAlign: 'center' }}>Gastos por Categoría</h3>
                            <div className="share-chart-bars" style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '12px' : '16px' }}>
                                {categoryData.map(([category, amount]) => {
                                    const percentage = (amount / maxCategoryAmount) * 100;
                                    return (
                                        <div key={category} className="share-chart-item" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div className="share-chart-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                                                <span className="share-category-name" style={{ fontWeight: 600, color: '#1f2937', fontSize: isMobile ? '0.875rem' : '1rem' }}>{category}</span>
                                                <span className="share-category-amount" style={{ fontWeight: 700, color: '#6b7280', fontSize: isMobile ? '0.875rem' : '1rem' }}>€{formatCurrency(amount)}</span>
                                            </div>
                                            <div className="share-chart-bar-container" style={{ height: isMobile ? '32px' : '40px', background: '#f3f4f6', borderRadius: '10px', overflow: 'hidden', border: '2px solid #e5e7eb' }}>
                                                <div
                                                    className="share-chart-bar-fill"
                                                    style={{ width: `${percentage}%`, height: '100%', background: 'linear-gradient(90deg, #ca8a04 0%, #d4af37 100%)', borderRadius: '8px', transition: 'none' }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="share-footer" style={{ textAlign: 'center', marginTop: isMobile ? '24px' : '40px', paddingTop: isMobile ? '16px' : '24px', borderTop: '2px solid #e5e7eb' }}>
                        <p style={{ fontSize: isMobile ? '0.75rem' : '0.875rem', color: '#6b7280', margin: 0, fontWeight: 500 }}>Generado el {new Date().toLocaleDateString('es-ES', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric'
                        })}</p>
                    </div>
                </div>

                <div className="share-actions">
                    <button
                        className="button secondary"
                        onClick={handleDownloadImage}
                        disabled={isGenerating}
                    >
                        {isGenerating ? 'Generando...' : '📥 Descargar PNG'}
                    </button>
                    <button
                        className="button secondary"
                        onClick={handleCopyToClipboard}
                        disabled={isGenerating}
                    >
                        {isGenerating ? 'Generando...' : '📋 Copiar Imagen'}
                    </button>
                    <button
                        className="button primary"
                        onClick={handleDownloadPDF}
                        disabled={isGenerating}
                    >
                        {isGenerating ? 'Generando...' : '📄 Descargar PDF'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShareModal;
