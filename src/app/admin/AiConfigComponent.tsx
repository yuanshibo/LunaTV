import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';
import {
  showError,
  showSuccess,
  useAlertModal,
  useLoadingState,
} from '@/lib/hooks';

import AlertModal from '@/components/AlertModal';

// 新增AI配置组件
const AiConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [aiSettings, setAiSettings] = useState({
    host: '',
    model: '',
  });

  useEffect(() => {
    if (config?.AiConfig) {
      setAiSettings(config.AiConfig);
    }
  }, [config]);

  const handleSave = async () => {
    await withLoading('saveAiConfig', async () => {
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

        showSuccess('保存成功', showAlert);
        await refreshConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    });
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
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          AI Host
        </label>
        <input
          type='text'
          value={aiSettings.host}
          onChange={(e) =>
            setAiSettings((prev) => ({ ...prev, host: e.target.value }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          AI Model
        </label>
        <input
          type='text'
          value={aiSettings.model}
          onChange={(e) =>
            setAiSettings((prev) => ({ ...prev, model: e.target.value }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={isLoading('saveAiConfig')}
          className={`px-4 py-2 ${
            isLoading('saveAiConfig')
              ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white rounded-lg'
              : 'bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 text-white rounded-lg transition-colors'
          } rounded-lg transition-colors`}
        >
          {isLoading('saveAiConfig') ? '保存中…' : '保存'}
        </button>
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

export default AiConfigComponent;
