"use client";

import React, { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  chapterKey?: string | number;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  resetCounter: number;
}

export class EditorErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "", resetCounter: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message, resetCounter: 0 };
  }

  componentDidUpdate(prevProps: Props) {
    // 章节切换时重置错误状态，让编辑器重新挂载
    if (this.state.hasError && prevProps.chapterKey !== this.props.chapterKey) {
      this.setState({ hasError: false, errorMessage: "", resetCounter: 0 });
    }
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      errorMessage: "",
      resetCounter: prev.resetCounter + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
          <AlertCircle className="size-12 text-amber-500" />
          <div className="text-center">
            <p className="text-base font-medium">编辑器渲染异常</p>
            <p className="mt-1 max-w-md text-sm opacity-70">
              编辑器组件遇到错误，可尝试切换章节或刷新页面恢复。
              <br />
              错误信息：{this.state.errorMessage}
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-muted/50"
            onClick={this.handleRetry}
          >
            <RefreshCw className="size-4" /> 重试
          </button>
        </div>
      );
    }
    // 用 resetCounter 驱动 children 重新挂载
    // 注意：必须传递 h-full 以维持 flex 高度传播链
    return (
      <div key={`${this.props.chapterKey ?? 0}-r${this.state.resetCounter}`} className="h-full">
        {this.props.children}
      </div>
    );
  }
}
