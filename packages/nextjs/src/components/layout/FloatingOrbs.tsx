export function FloatingOrbs() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      {/* Pink orb - top right */}
      <div 
        className="floating-orb w-96 h-96 bg-glow-pink"
        style={{ 
          top: '10%', 
          right: '10%',
          animationDelay: '0s'
        }}
      />
      
      {/* Cyan orb - left center */}
      <div 
        className="floating-orb w-80 h-80 bg-glow-cyan"
        style={{ 
          top: '40%', 
          left: '5%',
          animationDelay: '-7s'
        }}
      />
      
      {/* Green orb - bottom right */}
      <div 
        className="floating-orb w-72 h-72 bg-glow-green"
        style={{ 
          bottom: '20%', 
          right: '20%',
          animationDelay: '-14s'
        }}
      />
      
      {/* Purple orb - top left */}
      <div 
        className="floating-orb w-64 h-64 bg-glow-purple"
        style={{ 
          top: '20%', 
          left: '20%',
          animationDelay: '-5s'
        }}
      />

      {/* Small pink orb - bottom left */}
      <div 
        className="floating-orb w-48 h-48 bg-glow-pink"
        style={{ 
          bottom: '10%', 
          left: '30%',
          animationDelay: '-10s'
        }}
      />
    </div>
  );
}
