import { SUPPORTED_SITES } from "../../constants/constants.js";

const QuickLaunchGrid = ({ onLaunch }) => (
    <div className='grid gap-2 grid-cols-2 sm:grid-cols-3'>
        {Object.values(SUPPORTED_SITES).map((domain) => (
            <button key={domain.url} onClick={() => onLaunch(domain.url)} className="cursor-pointer group relative flex flex-col items-center justify-center gap-2 bg-zinc-900/50 border border-zinc-800/50 hover:border-zinc-700/50 hover:bg-zinc-800/50 px-4 py-3 rounded-lg transition-all active:scale-95">
                <div className="relative">
                    <img className='w-6 h-6 rounded shadow-sm' src={`https://www.google.com/s2/favicons?sz=64&domain=${domain.url}`} alt={domain.name} />
                    <div className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-zinc-900 ${domain.supported ? "bg-green-500" : "bg-red-500"}`}></div>
                </div>
                <small className='capitalize text-xs font-medium text-zinc-300 group-hover:text-white'>
                    {domain.name}
                </small>
            </button>
        ))}
    </div>
);

export default QuickLaunchGrid