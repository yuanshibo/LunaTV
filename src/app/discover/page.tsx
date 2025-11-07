'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { DoubanItem } from '@/lib/types';

import { Loading } from '@/components/Loading';
import VideoCard from '@/components/VideoCard';

const DiscoverPage: React.FC = () => {
  const [items, setItems] = useState<DoubanItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 25;

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/discover?start=${page * limit}&limit=${limit}`
      );
      const data = await response.json();
      if (data.list.length > 0) {
        setItems((prevItems) => [...prevItems, ...data.list]);
        setPage((prevPage) => prevPage + 1);
      }
      if (items.length >= data.total) {
        setHasMore(false);
      }
    } catch (error) {
      // TODO: handle error
    } finally {
      setIsLoading(false);
    }
  }, [page, isLoading, hasMore, items.length]);

  useEffect(() => {
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + document.documentElement.scrollTop <
        document.documentElement.offsetHeight - 500
      )
        return;
      loadMore();
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadMore]);

  return (
    <div className='container mx-auto p-4'>
      <h1 className='text-2xl font-bold mb-4'>Discover</h1>
      <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'>
        {items.map((item) => (
          <VideoCard
            key={item.id}
            id={item.id}
            title={item.title}
            poster={item.poster}
            rate={item.rate}
            year={item.year}
            from='douban'
          />
        ))}
      </div>
      {isLoading && <Loading />}
      {!hasMore && <div className='text-center my-4'>No more content</div>}
    </div>
  );
};

export default DiscoverPage;
