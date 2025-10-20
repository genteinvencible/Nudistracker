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

                <div className="share-preview" ref={contentRef}>
                    <div className="share-header">
                        <h1 className="share-title">Resumen Financiero</h1>
                        <p className="share-period">{getDateRangeText()}</p>
                    </div>

                    <div className="share-summary-cards">
                        <div className="share-card income">
                            <div className="share-card-icon">📈</div>
                            <div className="share-card-content">
                                <span className="share-card-label">Ingresos</span>
                                <span className="share-card-value">€{formatCurrency(totalIncome)}</span>
                            </div>
                        </div>
                        <div className="share-card expense">
                            <div className="share-card-icon">📉</div>
                            <div className="share-card-content">
                                <span className="share-card-label">Gastos</span>
                                <span className="share-card-value">€{formatCurrency(totalExpense)}</span>
                            </div>
                        </div>
                        <div className={`share-card balance ${balance >= 0 ? 'positive' : 'negative'}`}>
                            <div className="share-card-icon">{balance >= 0 ? '💰' : '⚠️'}</div>
                            <div className="share-card-content">
                                <span className="share-card-label">Balance</span>
                                <span className="share-card-value">€{formatCurrency(balance)}</span>
                            </div>
                        </div>
                    </div>

                    {categoryData.length > 0 && (
                        <div className="share-chart">
                            <h3 className="share-chart-title">Gastos por Categoría</h3>
                            <div className="share-chart-bars">
                                {categoryData.map(([category, amount]) => {
                                    const percentage = (amount / maxCategoryAmount) * 100;
                                    return (
                                        <div key={category} className="share-chart-item">
                                            <div className="share-chart-label">
                                                <span className="share-category-name">{category}</span>
                                                <span className="share-category-amount">€{formatCurrency(amount)}</span>
                                            </div>
                                            <div className="share-chart-bar-container">
                                                <div
                                                    className="share-chart-bar-fill"
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="share-footer">
                        <p>Generado el {new Date().toLocaleDateString('es-ES', {
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
