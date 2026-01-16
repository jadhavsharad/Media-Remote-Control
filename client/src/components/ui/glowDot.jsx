const GlowDot = ({ colorClass = "bg-white border-white" }) => (
  <div className="relative h-fit flex items-center justify-center">
    {["blur-lg", "blur-md", "blur-sm", "blur-xs", ""].map((blur, i) => (
      <div key={i} className={["w-2 aspect-square rounded-full saturate-200", colorClass, blur, i !== 0 ? "absolute" : "border"].join(" ")}
      />
    ))}
  </div>
);

export default GlowDot;
