'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { listBookings } from '@/lib/api'
import { bookingStatusConfig } from '@/lib/status'
import type { Booking } from '@/lib/types'
import Navbar from '@/components/Navbar'
import Spinner from '@/components/Spinner'

export default function DashboardPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'in_transit' | 'completed'>('all')

  useEffect(() => {
    listBookings()
      .then(setBookings)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Calculate statistics
  const stats = useMemo(() => {
    const total = bookings.length
    const active = bookings.filter(b => b.status === 'in_transit').length
    const completed = bookings.filter(b => b.status === 'completed' || b.status === 'paid').length
    const spend = bookings
      .filter(b => b.status === 'completed' || b.status === 'paid')
      .reduce((sum, b) => sum + (b.final_price ?? b.quoted_price), 0)
    return { total, active, completed, spend }
  }, [bookings])

  // Filter bookings based on activeTab
  const filteredBookings = useMemo(() => {
    switch (activeTab) {
      case 'pending':
        return bookings.filter(b => b.status === 'pending' || b.status === 'accepted')
      case 'in_transit':
        return bookings.filter(b => b.status === 'in_transit')
      case 'completed':
        return bookings.filter(b => b.status === 'completed' || b.status === 'paid')
      default:
        return bookings
    }
  }, [bookings, activeTab])

  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        
        {/* Page Title & Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shipper Operations Console</h1>
            <p className="text-sm text-gray-500 mt-1">Manage, negotiate, and track interstate cargo shipments</p>
          </div>
          <Link
            href="/bookings/new"
            className="bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md glow-blue self-start sm:self-auto"
          >
            <span className="text-lg leading-none">+</span> Post Load Request
          </Link>
        </div>

        {/* Statistics Cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-5 premium-shadow">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total Load Requests</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-extrabold text-gray-900">{stats.total}</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-250 p-5 premium-shadow border-l-4 border-l-amber-500">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Active Shipments</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-extrabold text-amber-600">{stats.active}</span>
              <span className="text-xs text-amber-500 font-semibold animate-pulse ml-2">● Live</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5 premium-shadow border-l-4 border-l-green-500">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Completed Deliveries</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-extrabold text-green-600">{stats.completed}</span>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5 premium-shadow border-l-4 border-l-blue-500">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Freight Spend</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-extrabold text-blue-750">₹{stats.spend.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex border-b border-gray-200 gap-6">
          {[
            { id: 'all', label: 'All Loads', count: bookings.length },
            { id: 'pending', label: 'Bids & Pending', count: bookings.filter(b => b.status === 'pending' || b.status === 'accepted').length },
            { id: 'in_transit', label: 'In Transit', count: stats.active },
            { id: 'completed', label: 'Completed', count: stats.completed },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-4 text-sm font-semibold border-b-2 transition-all relative ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
              <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Bookings Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="text-center py-20 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-500 font-semibold text-lg">No loads found</p>
            <p className="text-sm text-gray-400 mt-1">There are no load requests matching this category.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredBookings.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        )}
      </main>
    </>
  )
}

function BookingCard({ booking }: { booking: Booking }) {
  const status = bookingStatusConfig[booking.status]

  return (
    <Link
      href={`/bookings/${booking.id}`}
      className="block bg-white rounded-2xl border border-gray-200 p-5 premium-card-hover premium-shadow"
    >
      <div className="flex items-center justify-between mb-4">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg ${status.color}`}>
          {status.label}
        </span>
        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
          {booking.booking_type}
        </span>
      </div>

      {/* Visual vertical route timeline */}
      <div className="relative pl-6 mb-5 space-y-3">
        <div className="absolute top-1.5 left-[5px] bottom-1.5 w-[2px] bg-slate-100 border-l border-dashed border-slate-300" />
        
        <div className="relative">
          <div className="absolute -left-[24px] top-1 w-3.5 h-3.5 rounded-full bg-emerald-50 border-3 border-emerald-500" />
          <div>
            <p className="text-[9px] text-gray-400 uppercase font-semibold">Origin</p>
            <p className="text-xs font-bold text-gray-800 truncate" title={booking.source_address}>
              {booking.source_address}
            </p>
          </div>
        </div>
        
        <div className="relative">
          <div className="absolute -left-[24px] top-1 w-3.5 h-3.5 rounded-full bg-red-50 border-3 border-red-500" />
          <div>
            <p className="text-[9px] text-gray-400 uppercase font-semibold">Destination</p>
            <p className="text-xs font-bold text-gray-800 truncate" title={booking.destination_address}>
              {booking.destination_address}
            </p>
          </div>
        </div>
      </div>

      {/* Booking attributes grid */}
      <div className="grid grid-cols-2 gap-y-3 gap-x-2 border-t border-gray-100 pt-4 text-xs text-gray-500">
        <div>
          <span className="text-gray-400 block text-[10px] uppercase font-semibold">Load Type</span>
          <span className="font-bold text-gray-700 capitalize mt-0.5 inline-block">{booking.load_type}</span>
        </div>
        <div>
          <span className="text-gray-400 block text-[10px] uppercase font-semibold">Cargo Weight</span>
          <span className="font-bold text-gray-700 mt-0.5 inline-block">{booking.weight_kg.toLocaleString()} kg</span>
        </div>
        <div>
          <span className="text-gray-400 block text-[10px] uppercase font-semibold">Quoted Price</span>
          <span className="font-extrabold text-blue-700 text-sm mt-0.5 inline-block">
            ₹{(booking.final_price ?? booking.quoted_price).toLocaleString('en-IN')}
          </span>
        </div>
        <div>
          <span className="text-gray-400 block text-[10px] uppercase font-semibold">Pickup Date</span>
          <span className="font-bold text-gray-700 mt-0.5 inline-block">
            {new Date(booking.pickup_date).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        </div>
      </div>
    </Link>
  )
}
