"use client"
import React from "react"
import { AlertCircle } from "lucide-react"

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div className="p-6 border border-danger/20 bg-danger/5 rounded-xl flex flex-col items-center justify-center text-center min-h-[200px]">
          <AlertCircle className="w-8 h-8 text-danger mb-3" />
          <h3 className="text-foreground font-semibold mb-1">Something went wrong</h3>
          <p className="text-muted-foreground text-sm max-w-xs">{this.state.error?.message || "An unexpected error occurred."}</p>
        </div>
      )
    }

    return this.props.children
  }
}
