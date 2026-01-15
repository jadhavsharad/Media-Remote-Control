import { Html5Qrcode } from 'html5-qrcode';
import { useEffect, useRef, useState } from 'react';

const qrcodeRegionId = "html5qr-code-full-region";

const Html5QrcodePlugin = ({
    fps = 10,
    qrbox = 250,
    aspectRatio = 1,
    disableFlip = false,
    verbose = false,
    qrCodeSuccessCallback,
    qrCodeErrorCallback
}) => {
    const [scanError, setScanError] = useState(null);
    const [isScanning, setIsScanning] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [fileSelected, setFileSelected] = useState(false);
    const html5QrCodeRef = useRef(null);
    const fileInputRef = useRef(null);

    const startScanning = async () => {
        if (!html5QrCodeRef.current) return;
        try {
            setIsLoading(true);
            setFileSelected(false);
            const config = { fps, qrbox, aspectRatio, disableFlip };
            await html5QrCodeRef.current.start(
                { facingMode: "environment" },
                config,
                (decodedText, decodedResult) => { if (qrCodeSuccessCallback) qrCodeSuccessCallback(decodedText, decodedResult) },
                (errorMessage) => { if (qrCodeErrorCallback) qrCodeErrorCallback(errorMessage) }
            );
            setIsScanning(true);
            setScanError(null);
        } catch (err) {
            console.error("Error starting QR scanner:", err);
            setScanError("Failed to access camera.");
            setIsScanning(false);
        } finally {
            setIsLoading(false);
        }
    };

    const stopScanning = async () => {
        if (html5QrCodeRef.current && isScanning) {
            try {
                await html5QrCodeRef.current.stop();
                setIsScanning(false);
            } catch (err) {
                console.error("Failed to stop scanner", err);
            }
        }
    };

    const handleFileChange = async (e) => {
        if (e.target.files.length === 0 || !html5QrCodeRef.current) return;

        const imageFile = e.target.files[0];
        try {
            setIsLoading(true);
            setFileSelected(true);
            const result = await html5QrCodeRef.current.scanFileV2(imageFile, true);
            if (qrCodeSuccessCallback) {
                qrCodeSuccessCallback(result.decodedText, result);
            }
        } catch (err) {
            setScanError("Could not monitor QR code from this image");
            console.error("Error scanning file:", err);
            setFileSelected(false);
        } finally {
            setIsLoading(false);
            e.target.value = '';
        }
    };

    useEffect(() => {
        const html5QrCode = new Html5Qrcode(qrcodeRegionId, verbose);
        html5QrCodeRef.current = html5QrCode;

        return () => {
            if (html5QrCodeRef.current) {
                if (html5QrCodeRef.current.isScanning) {
                    html5QrCodeRef.current.stop().catch(err => console.error("Cleanup error", err)).finally(() => { html5QrCodeRef.current.clear() });
                } else {
                    html5QrCodeRef.current.clear();
                }
            }
        };
    }, []);

    return (
        <div className="flex flex-col gap-4 max-w-xs w-full mx-auto">
            <div className={`relative overflow-hidden`}>
                <div id={qrcodeRegionId} className='w-full h-full' />
                {isScanning && !scanError && (
                    <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute saturate-150 top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-emerald-500 to-transparent opacity-75 shadow-[0_0_10px_rgba(16,185,129,0.8)] animate-scan"></div>
                        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#10b981_1px,transparent_1px)] bg-size-[16px_16px]"></div>
                    </div>
                )}

                {scanError && (
                    <div className="absolute inset-0 flex items-center justify-center p-4 text-center bg-zinc-900/90 text-red-400 text-sm font-medium">
                        {scanError}
                    </div>
                )}
            </div>
            {
                (!isScanning && !isLoading && !fileSelected) && (
                    <p className='w-full text-sm p-6 gap-y-4 flex flex-col min-h-16 border border-dashed border-zinc-400 text-center'>
                        Open the extension or select file to scan QR code and pair with host device.
                        <small>Devices will get linked for upto 30days.</small>
                    </p>
                )
            }

            <div className="flex gap-2 justify-center">
                <button disabled={isLoading} onClick={() => isScanning ? stopScanning() : startScanning()} className={`disabled:text-zinc-400 disabled:bg-zinc-600 cursor-pointer disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition-colors ${isScanning ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'}`}>
                    {isScanning ? 'Stop Scan' : 'Start Scan'}
                </button>

                <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />

                <button onClick={() => fileInputRef.current?.click()} className=" cursor-pointer disabled:cursor-not-allowed px-4 py-2 text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">Scan Image</button>
            </div>
        </div>
    );
};

export default Html5QrcodePlugin;