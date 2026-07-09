import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAppStore } from './stores/useAppStore';
import { fetchCourses, fetchTeachers } from './utils/api';
import Layout from './components/Layout';
import ConsentPage from './pages/ConsentPage';
import PoolPage from './pages/PoolPage';
import SchedulePage from './pages/SchedulePage';
import SettingsPage from './pages/SettingsPage';
import Toast from './components/Toast';

export default function App() {
  const { consentGiven, setCourses, setTeachers } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 初始化：加载模拟数据
    Promise.all([fetchCourses(), fetchTeachers()])
      .then(([courses, teachers]) => {
        setCourses(courses);
        setTeachers(teachers);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [setCourses, setTeachers]);

  if (!consentGiven) {
    return <ConsentPage />;
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>正在加载数据…</p>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/pool" replace />} />
          <Route path="/pool" element={<PoolPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toast />
    </>
  );
}
