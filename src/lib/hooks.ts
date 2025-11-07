import { useState } from 'react';

// 弹窗状态管理
export const useAlertModal = () => {
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message?: string;
    timer?: number;
    showConfirm?: boolean;
  }>({
    isOpen: false,
    type: 'success',
    title: '',
  });

  const showAlert = (config: Omit<typeof alertModal, 'isOpen'>) => {
    setAlertModal({ ...config, isOpen: true });
  };

  const hideAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  return { alertModal, showAlert, hideAlert };
};

// 统一弹窗方法（必须在首次使用前定义）
export const showError = (
  message: string,
  showAlert?: (config: Omit<{
    isOpen: boolean;
    type: "success" | "error" | "warning";
    title: string;
    message?: string | undefined;
    timer?: number | undefined;
    showConfirm?: boolean | undefined;
}, "isOpen">) => void
) => {
  if (showAlert) {
    showAlert({ type: 'error', title: '错误', message, showConfirm: true });
  }
};

export const showSuccess = (
  message: string,
  showAlert?: (config: Omit<{
    isOpen: boolean;
    type: "success" | "error" | "warning";
    title: string;
    message?: string | undefined;
    timer?: number | undefined;
    showConfirm?: boolean | undefined;
}, "isOpen">) => void
) => {
  if (showAlert) {
    showAlert({ type: 'success', title: '成功', message, timer: 2000 });
  }
};

// 通用加载状态管理系统
interface LoadingState {
  [key: string]: boolean;
}

export const useLoadingState = () => {
  const [loadingStates, setLoadingStates] = useState<LoadingState>({});

  const setLoading = (key: string, loading: boolean) => {
    setLoadingStates((prev) => ({ ...prev, [key]: loading }));
  };

  const isLoading = (key: string) => loadingStates[key] || false;

  const withLoading = async <T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    setLoading(key, true);
    try {
      const result = await operation();
      return result;
    } finally {
      setLoading(key, false);
    }
  };

  return { loadingStates, setLoading, isLoading, withLoading };
};
