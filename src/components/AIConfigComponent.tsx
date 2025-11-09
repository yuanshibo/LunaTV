/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion,react-hooks/exhaustive-deps,@typescript-eslint/no-empty-function */
'use client';

import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

// 按钮样式
const buttonStyles = {
  success: 'px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 text-white rounded-lg transition-colors',
  disabled: 'px-3 py-1.5 text-sm font-medium bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white rounded-lg transition-colors',
};

// AI配置组件
const AIConfigComponent = ({ config, refreshConfig }: { config: AdminConfig | null; refreshConfig: () => Promise<void> }) => {
  const [aiSettings, setAiSettings] = useState({
    ollama_host: '',
    ollama_model: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showAlert, setShowAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (config?.AIConfig) {
      setAiSettings(config.AIConfig);
    }
  }, [config]);

  // 保存AI配置
  const handleSave = async () => {
    setIsLoading(true);
    setShowAlert(null);
    try {
      const resp = await fetch('/api/admin/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...aiSettings }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `保存失败: ${resp.status}`);
      }

      setShowAlert({ type: 'success', message: '保存成功, 请刷新页面' });
      await refreshConfig();
    } catch (err) {
      setShowAlert({ type: 'error', message: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setIsLoading(false);
      setTimeout(() => setShowAlert(null), 3000);
    }
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className='border-t border-gray-200 dark:border-gray-700 pt-6'>
        <h3 className='text-md font-semibold text-gray-800 dark:text-gray-200 mb-4'>AI 推荐配置</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Ollama Host
          </label>
          <input
            type='text'
            value={aiSettings.ollama_host}
            onChange={(e) =>
              setAiSettings((prev) => ({ ...prev, ollama_host: e.target.value }))
            }
            placeholder='例如: http://127.0.0.1:11434'
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
        <div className='mt-4'>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Ollama Model
          </label>
          <input
            type='text'
            value={aiSettings.ollama_model}
            onChange={(e) =>
              setAiSettings((prev) => ({ ...prev, ollama_model: e.target.value }))
            }
            placeholder='例如: llama3'
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* 操作按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={isLoading}
          className={`px-4 py-2 ${isLoading
            ? buttonStyles.disabled
            : buttonStyles.success
            } rounded-lg transition-colors`}
        >
          {isLoading ? '保存中…' : '保存'}
        </button>
      </div>

      {/* 弹窗提示 */}
      {showAlert && (
        <div className={`fixed bottom-5 right-5 p-4 rounded-lg text-white ${showAlert.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
          {showAlert.message}
        </div>
      )}
    </div>
  );
};

export default AIConfigComponent;
