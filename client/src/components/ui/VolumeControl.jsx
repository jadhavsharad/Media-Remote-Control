import { IoMdVolumeLow, IoMdVolumeHigh } from "react-icons/io";

const VolumeControl = ({ activeTab, onVolumeChange }) => {
    const volumeLevels = [0.2, 0.4, 0.6, 0.8, 1];
    const currentVolume = activeTab?.volume || 0;
    const isEnabled = !!activeTab;

    return (
        <div className={`w-full flex items-center justify-center gap-2 border border-zinc-800 rounded-lg px-4 py-2 ${!isEnabled && 'opacity-50 pointer-events-none'}`}>
            <IoMdVolumeLow className={`shrink-0 text-center`} size={20} />
            <div className='flex flex-1 gap-1 h-8'>
                {volumeLevels.map((level) => {
                    const isActive = currentVolume >= level;
                    return (
                        <button key={level} onClick={() => onVolumeChange(level)} className={`relative rounded-lg flex-1 h-full mx-0.5  overflow-hidden transition-all duration-200 active:scale-95 group`}>
                            <div className={`absolute inset-0 w-full h-full transition-all duration-200 ${isActive ? 'bg-zinc-100' : 'bg-zinc-700 group-hover:bg-zinc-700'}`}></div>
                        </button>
                    )
                })}
            </div>
            <IoMdVolumeHigh className={`shrink-0 text-center`} size={20} />
        </div>
    );
}

export default VolumeControl