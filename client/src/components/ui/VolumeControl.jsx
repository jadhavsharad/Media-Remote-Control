import { IoMdVolumeLow, IoMdVolumeHigh } from "react-icons/io";

const VolumeControl = ({ activeTab, onVolumeChange }) => {
    const volumeLevels = [0.2, 0.4, 0.6, 0.8, 1];
    const currentVolume = activeTab?.volume || 0;
    const isEnabled = !!activeTab;

    return (
        <div className="bg-zinc-900 rounded-lg border border-zinc-900 ">
            <div className="flex justify-between items-center px-4 py-1">
                <small className="text-xs font-mono tracking-wider font-semibold text-zinc-500">Volume</small>
                <small className="text-xs font-mono tracking-wider font-semibold text-zinc-500">{currentVolume * 100}%</small>
            </div>
            <div className={`w-full flex items-center justify-center gap-2 rounded-[inherit] bg-zinc-950  px-4 py-2 ${!isEnabled && 'opacity-50 pointer-events-none'}`}>
                <IoMdVolumeLow className={`shrink-0 text-center`} size={20} />
                <div className='flex flex-1 gap-1 h-8'>
                    {volumeLevels.map((level) => {
                        const isActive = currentVolume >= level;
                        return (
                            <button key={level} onClick={() => onVolumeChange(level)} className={`relative disabled:cursor-not-allowed cursor-pointer rounded-lg flex-1 h-full mx-0.5  overflow-hidden transition-all duration-200 active:scale-95 group`}>
                                <div className={`absolute inset-0 w-full h-full transition-all duration-200 ${isActive ? 'bg-zinc-100' : 'bg-zinc-700 group-hover:bg-zinc-700'}`}></div>
                            </button>
                        )
                    })}
                </div>
                <IoMdVolumeHigh className={`shrink-0 text-center`} size={20} />
            </div>
        </div>
    );
}

export default VolumeControl