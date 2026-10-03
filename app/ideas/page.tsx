"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Compass,
  BookOpen,
  Calendar,
  Sparkles,
  ArrowUpRight,
  Send,
  Clock,
  Mail,
  MessageSquare,
} from "lucide-react";

/* ─── 应用卡片数据 ─── */
const apps = [
  {
    href: "/gua",
    icon: Compass,
    title: "周易灵签",
    subtitle: "I Ching Divination",
    description: "摇卦问事，六十四卦象解读，融合 AI 解签师为你揭示卦义与启示",
    gradient: "from-amber-500/20 via-orange-500/10 to-rose-500/20",
    accentColor: "text-amber-400",
    glowColor: "group-hover:shadow-amber-500/20",
  },
  {
    href: "/bazi",
    icon: Calendar,
    title: "八字命理",
    subtitle: "BaZi Analysis",
    description: "输入生辰，推排四柱八字、十神格局与灵魂能量，AI 深度解读命盘",
    gradient: "from-violet-500/20 via-purple-500/10 to-indigo-500/20",
    accentColor: "text-violet-400",
    glowColor: "group-hover:shadow-violet-500/20",
  },
  {
    href: "/docs",
    icon: BookOpen,
    title: "文章",
    subtitle: "Reading Room",
    description: "读书笔记与技术长文归档，支持目录检索与沉浸式在线阅读体验",
    gradient: "from-cyan-500/20 via-sky-500/10 to-blue-500/20",
    accentColor: "text-cyan-400",
    glowColor: "group-hover:shadow-cyan-500/20",
  },
];

/* ─── 动画变体 ─── */
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.3 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

interface Idea {
  id: string;
  email: string;
  description: string;
  createdAt: string;
}

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchIdeas();
  }, []);

  const fetchIdeas = async () => {
    try {
      const res = await fetch("/api/ideas");
      const data = await res.json();
      setIdeas(data);
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, description }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "提交失败" });
      } else {
        setMessage({ type: "success", text: "已收录，感谢分享！" });
        setEmail("");
        setDescription("");
        setIdeas((prev) => [data, ...prev]);
      }
    } catch {
      setMessage({ type: "error", text: "网络错误，请重试" });
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="relative min-h-screen bg-[#050507] text-white overflow-hidden">
      {/* ─── 动态渐变背景 ─── */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.12)_0%,transparent_70%)] animate-[aurora_20s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-30%] right-[-15%] w-[80vw] h-[80vw] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.1)_0%,transparent_70%)] animate-[aurora_25s_ease-in-out_infinite_reverse]" />
        <div className="absolute top-[30%] right-[10%] w-[50vw] h-[50vw] rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.06)_0%,transparent_70%)] animate-[aurora_18s_ease-in-out_infinite_3s]" />
        {/* 噪点纹理 */}
        <div className="absolute inset-0 opacity-[0.015] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iLjc1IiBzdGl0Y2hUaWxlcz0ic3RpdGNoIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiIGZpbHRlcj0idXJsKCNhKSIvPjwvc3ZnPg==')]" />
      </div>

      {/* ─── Hero 区 ─── */}
      <header className="relative z-10 pt-24 pb-16 px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] mb-8 backdrop-blur-sm">
            <Sparkles size={14} className="text-violet-400" />
            <span className="text-xs tracking-wide text-zinc-400 uppercase">无用之用</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-semibold tracking-tight mb-6">
            <span className="bg-gradient-to-b from-white via-white to-zinc-500 bg-clip-text text-transparent">
              探索应用
            </span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-500 max-w-xl mx-auto leading-relaxed font-light">
            美丽的小野花，也让这个世界更美丽
          </p>
        </motion.div>
      </header>

      {/* ─── 应用卡片导航 ─── */}
      <section className="relative z-10 px-6 pb-24">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto"
        >
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <motion.div key={app.href} variants={cardVariants}>
                <Link
                  href={app.href}
                  className={`group relative block rounded-3xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-8 transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:border-white/[0.12] hover:bg-white/[0.04] hover:shadow-2xl hover:-translate-y-1 ${app.glowColor}`}
                >
                  {/* 卡片内渐变光 */}
                  <div
                    className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${app.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-700`}
                  />

                  <div className="relative z-10">
                    <div className="mb-6 inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/[0.08] group-hover:border-white/[0.15] transition-colors duration-500">
                      <Icon size={22} className={`${app.accentColor} transition-transform duration-500 group-hover:scale-110`} />
                    </div>

                    <h2 className="text-xl font-semibold text-white mb-1 tracking-tight">
                      {app.title}
                    </h2>
                    <p className="text-xs text-zinc-600 uppercase tracking-widest mb-4">
                      {app.subtitle}
                    </p>
                    <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                      {app.description}
                    </p>

                    <div className="flex items-center gap-1.5 text-sm text-zinc-500 group-hover:text-zinc-300 transition-colors duration-300">
                      <span>进入应用</span>
                      <ArrowUpRight
                        size={14}
                        className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      />
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      {/* ─── 创意收集区 ─── */}
      <section className="relative z-10 px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
              <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                提交你的想法
              </span>
            </h2>
            <p className="text-zinc-500 max-w-md mx-auto">
              没有商业价值，但有用的 AI 应用创意
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* 提交表单 */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              <div className="sticky top-8">
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 backdrop-blur-xl">
                  <h3 className="text-lg font-medium mb-6 flex items-center gap-2">
                    <Send size={18} className="text-violet-400" />
                    分享创意
                  </h3>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label className="block text-sm text-zinc-400 mb-2 flex items-center gap-2">
                        <Mail size={14} />
                        邮箱（用于通知，不会公开）
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="your@email.com"
                        required
                        className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] transition-all duration-300"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-zinc-400 mb-2 flex items-center gap-2">
                        <MessageSquare size={14} />
                        需求描述
                        <span className="text-zinc-600 ml-auto">{description.length}/200</span>
                      </label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                        placeholder="描述一个你想要的、但目前市面上没有的 AI 小工具..."
                        required
                        rows={4}
                        className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] transition-all duration-300 resize-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 px-6 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {submitting ? (
                        <span className="animate-pulse">提交中...</span>
                      ) : (
                        <>
                          <Send size={18} />
                          提交想法
                        </>
                      )}
                    </button>
                  </form>

                  <AnimatePresence>
                    {message && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className={`mt-4 p-4 rounded-xl text-sm ${
                          message.type === "success"
                            ? "bg-green-500/10 border border-green-500/20 text-green-400"
                            : "bg-red-500/10 border border-red-500/20 text-red-400"
                        }`}
                      >
                        {message.text}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>

            {/* 已收录列表 */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.7 }}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Sparkles size={18} className="text-violet-400" />
                  已收录的想法
                  <span className="text-sm text-zinc-600 font-normal ml-2">({ideas.length})</span>
                </h3>
              </div>

              {ideas.length === 0 ? (
                <div className="text-center py-16 text-zinc-600">
                  <Sparkles size={48} className="mx-auto mb-4 opacity-30" />
                  <p>还没有想法，成为第一个分享的人吧</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <AnimatePresence>
                    {ideas.map((idea, index) => (
                      <motion.div
                        key={idea.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.3, delay: index * 0.05 }}
                        className="group bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 hover:border-violet-500/20 transition-all duration-300"
                      >
                        <p className="text-zinc-200 leading-relaxed mb-4">
                          {idea.description}
                        </p>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-zinc-600 truncate max-w-[160px]">{idea.email}</span>
                          <span className="text-zinc-600 flex items-center gap-1">
                            <Clock size={12} />
                            {formatDate(idea.createdAt)}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── 底部 ─── */}
      <footer className="relative z-10 border-t border-white/[0.04] py-10 text-center">
        <p className="text-sm text-zinc-600">
          无用之用 · 收集那些不会改变世界但能温暖人心的想法
        </p>
      </footer>

      {/* ─── 关键帧动画 ─── */}
      <style jsx global>{`
        @keyframes aurora {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          25% {
            transform: translate(5%, -8%) scale(1.05);
          }
          50% {
            transform: translate(-3%, 5%) scale(0.95);
          }
          75% {
            transform: translate(7%, 3%) scale(1.02);
          }
        }
      `}</style>
    </div>
  );
}
