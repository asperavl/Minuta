import Link from "next/link";
import { ArrowRight, CheckCircle2, Search, Zap, Clock, Shield, ChevronDown, ListChecks, MessageSquare, BarChart } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      
      {/* 1. Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-24 md:py-32 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent/20 rounded-full blur-[100px] -z-10 pointer-events-none" />
        
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-subtle border border-accent/20 text-accent text-xs font-semibold tracking-wider uppercase mb-8">
          <Zap className="w-4 h-4" /> Meeting Intelligence Hub
        </div>
        
        <h1 className="text-4xl md:text-6xl font-extrabold max-w-4xl tracking-tight mb-6 leading-tight">
          Turn transcripts into <br className="hidden md:block"/>
          <span className="text-accent">actionable insights.</span>
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground/80 max-w-2xl mb-10 leading-relaxed">
          Minuta automatically extracts decisions, action items, and sentiment from your meeting transcripts. Never miss a follow-up again.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
          <Link 
            href="/login" 
            className="flex items-center gap-2 px-8 py-3.5 bg-accent hover:bg-accent-hover text-white rounded-xl font-medium transition-colors w-full sm:w-auto justify-center"
          >
            Sign in with Google <ArrowRight className="w-4 h-4" />
          </Link>
          <a 
            href="#how-it-works" 
            className="flex items-center gap-2 px-8 py-3.5 bg-surface-2 hover:bg-surface border border-border text-foreground rounded-xl font-medium transition-colors w-full sm:w-auto justify-center"
          >
            See how it works
          </a>
        </div>
      </section>

      {/* 2. Problem Section */}
      <section className="py-24 bg-surface/30 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Meetings are broken.</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">We spend hours talking, but action items get lost in the noise.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { title: "Lost Action Items", desc: "Commitments fade away the moment the Zoom call ends." },
              { title: "Missing Context", desc: "Weeks later, no one remembers why a decision was made." },
              { title: "Unread Transcripts", desc: "You download the VTT, but nobody ever reads it." }
            ].map((card, i) => (
              <div key={i} className="p-8 rounded-2xl bg-surface border border-border flex flex-col gap-3">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent mb-2">
                  <Search className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-semibold">{card.title}</h3>
                <p className="text-muted-foreground">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Feature Showcase */}
      <section className="py-24 px-4 overflow-hidden relative">
        <div className="max-w-6xl mx-auto space-y-32">
          
          {/* Feature 1 */}
          <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-24">
            <div className="flex-1 space-y-6">
              <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                <ListChecks className="w-6 h-6" />
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold">Automatic Action Item Extraction</h2>
              <p className="text-lg text-muted-foreground">Minuta identifies who is doing what and by when. It maps every task back to the exact quote in the transcript for full context.</p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-2xl aspect-video flex items-center justify-center text-muted-foreground font-medium shadow-2xl relative">
               <div className="absolute inset-0 bg-gradient-to-tr from-accent/5 to-transparent rounded-2xl"></div>
               [ Screenshot Placeholder: Action Items Table ]
            </div>
          </div>

          {/* Feature 2 */}
          <div className="flex flex-col-reverse md:flex-row items-center gap-12 lg:gap-24">
            <div className="flex-1 w-full bg-surface border border-border rounded-2xl aspect-video flex items-center justify-center text-muted-foreground font-medium shadow-2xl relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-accent/5 to-transparent rounded-2xl"></div>
              [ Screenshot Placeholder: Timeline and Sentiment ]
            </div>
            <div className="flex-1 space-y-6">
              <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                <BarChart className="w-6 h-6" />
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold">Topic Tracking & Sentiment</h2>
              <p className="text-lg text-muted-foreground">Visually scan how the meeting progressed. Spot conflict points instantly and see when critical decisions were actually made.</p>
            </div>
          </div>
          
          {/* Feature 3 */}
          <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-24">
            <div className="flex-1 space-y-6">
              <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold">Chat with your Transcripts</h2>
              <p className="text-lg text-muted-foreground">Ask questions across individual meetings or your entire project history. The AI answers with precise citations back to the source.</p>
            </div>
            <div className="flex-1 w-full bg-surface border border-border rounded-2xl aspect-[4/3] flex items-center justify-center text-muted-foreground font-medium shadow-2xl relative md:max-w-[400px] ml-auto">
               <div className="absolute inset-0 bg-gradient-to-tr from-accent/5 to-transparent rounded-2xl"></div>
               [ Screenshot Placeholder: Chat UI ]
            </div>
          </div>

        </div>
      </section>

      {/* 4. How it works */}
      <section id="how-it-works" className="py-24 bg-surface/30 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-16">How it works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center text-2xl font-bold mb-6 text-accent">1</div>
              <h3 className="text-xl font-semibold mb-2">Upload Transcript</h3>
              <p className="text-muted-foreground text-center">Drop in your raw `.vtt` file straight from Zoom, Teams, or Meet.</p>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center text-2xl font-bold mb-6 text-accent">2</div>
              <h3 className="text-xl font-semibold mb-2">AI Processing</h3>
              <p className="text-muted-foreground text-center">Our pipeline cleans the data and securely passes it to Google Gemini.</p>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center text-2xl font-bold mb-6 text-accent">3</div>
              <h3 className="text-xl font-semibold mb-2">Instant Dashboard</h3>
              <p className="text-muted-foreground text-center">Your personalized intelligence hub is generated in seconds.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Credibility Bar */}
      <section className="py-12 border-y border-border px-4">
        <div className="max-w-6xl mx-auto flex flex-wrap justify-center gap-8 md:gap-16 text-muted-foreground font-medium">
          <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-success" /> Secure Processing</div>
          <div className="flex items-center gap-2"><Clock className="w-5 h-5 text-accent" /> Millisecond Search</div>
          <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-warning" /> Hallucination Safety DB</div>
          <div className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-primary" /> Contextual Awareness</div>
        </div>
      </section>

      {/* 6. Final CTA */}
      <section className="py-32 px-4 text-center relative overflow-hidden">
        <div className="max-w-3xl mx-auto space-y-8 relative z-10">
          <h2 className="text-4xl font-bold">Ready to remember everything?</h2>
          <p className="text-xl text-muted-foreground">Start processing your meetings with context and intelligence today.</p>
          <Link 
            href="/login" 
            className="inline-flex items-center gap-2 px-10 py-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold transition-colors text-lg"
          >
            Sign in with Google
          </Link>
        </div>
      </section>

      <footer className="py-12 border-t border-border px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-muted-foreground">
          <div className="md:flex-1 font-bold text-foreground text-xl tracking-tight text-center md:text-left w-full">Minuta</div>
          <div className="flex items-center justify-center gap-6 font-medium">
            <Link href="/login" className="hover:text-foreground transition-colors">Login</Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">Sign up</Link>
          </div>
          <div className="md:flex-1 text-sm text-center md:text-right w-full">© {new Date().getFullYear()} Minuta.</div>
        </div>
      </footer>

    </div>
  );
}
